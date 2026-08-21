const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const sig = event.headers['stripe-signature'];
    let stripeEvent;

    try { stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } 
    catch (err) { return { statusCode: 400, body: `Webhook Error: ${err.message}` }; }

    const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // 1. GESTION DES NOUVEAUX PAIEMENTS ET RENOUVELLEMENTS
    if (stripeEvent.type === 'checkout.session.completed' || stripeEvent.type === 'invoice.paid') {
        let emailClient, priceOriginalCentimes = 0;
        
        if (stripeEvent.type === 'checkout.session.completed') {
            const session = stripeEvent.data.object; emailClient = session.customer_details.email;
            const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] });
            priceOriginalCentimes = sessionWithLineItems.line_items.data[0].price.unit_amount;
        } else if (stripeEvent.type === 'invoice.paid') {
            const invoice = stripeEvent.data.object; emailClient = invoice.customer_email;
            priceOriginalCentimes = invoice.lines.data[0].price.unit_amount;
        }

        const prixEurosStripe = priceOriginalCentimes / 100;
        const { data: offres } = await supabaseAdmin.from('offres').select('*');
        const offreTrouvee = offres.find(o => parseFloat(o.prix_euros) === prixEurosStripe);
        
        const partagesDefinis = offreTrouvee ? (offreTrouvee.partages_autorises || 0) : 1;
        const nomOffre = offreTrouvee ? offreTrouvee.nom : 'Premium';

        let nouvelleDate = new Date(); nouvelleDate.setDate(nouvelleDate.getDate() + 31);

        await supabaseAdmin.from('lecteurs').update({
            est_abonne: true,
            fin_abonnement: nouvelleDate.toISOString(),
            credits_partage: partagesDefinis,
            offre_nom: nomOffre,
            offre_prix: prixEurosStripe,
            abonnement_offert: false,
            annulation_programmee: false // Remet à zéro si le client se réabonne
        }).eq('email', emailClient);
    }
    
    // 2. GESTION DES ANNULATIONS DANS LE PORTAIL STRIPE
    if (stripeEvent.type === 'customer.subscription.updated' || stripeEvent.type === 'customer.subscription.deleted') {
        const subscription = stripeEvent.data.object;
        const customer = await stripe.customers.retrieve(subscription.customer);
        const emailClient = customer.email;
        
        // cancel_at_period_end est true quand il clique sur "Annuler"
        const estAnnule = subscription.cancel_at_period_end || subscription.status === 'canceled';

        if (emailClient) {
            await supabaseAdmin.from('lecteurs').update({
                annulation_programmee: estAnnule
            }).eq('email', emailClient);
        }
    }

    return { statusCode: 200, body: 'Webhook traité avec succès !' };
};

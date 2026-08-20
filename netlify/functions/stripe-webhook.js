const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const sig = event.headers['stripe-signature'];
    let stripeEvent;

    try {
        stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    if (stripeEvent.type === 'checkout.session.completed' || stripeEvent.type === 'invoice.paid') {
        
        let emailClient;
        let priceOriginalCentimes = 0;
        
        // 1. Récupération des infos selon l'événement (Nouvel achat ou Renouvellement)
        if (stripeEvent.type === 'checkout.session.completed') {
            const session = stripeEvent.data.object;
            emailClient = session.customer_details.email;
            const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] });
            // On récupère le prix original (avant application du code promo à 100%)
            priceOriginalCentimes = sessionWithLineItems.line_items.data[0].price.unit_amount;
        } 
        else if (stripeEvent.type === 'invoice.paid') {
            const invoice = stripeEvent.data.object;
            emailClient = invoice.customer_email;
            priceOriginalCentimes = invoice.lines.data[0].price.unit_amount;
        }

        // 2. Conversion du prix Stripe (en centimes) vers des Euros (ex: 999 devient 9.99)
        const prixEurosStripe = priceOriginalCentimes / 100;

        // 3. On cherche l'offre dans Supabase qui correspond exactement à ce prix
        const { data: offres } = await supabaseAdmin.from('offres').select('*');
        const offreTrouvee = offres.find(o => parseFloat(o.prix_euros) === prixEurosStripe);
        
        // Si on trouve l'offre, on attribue ses partages. Sinon, on sécurise avec 1 partage minimum.
        const partagesDefinis = offreTrouvee ? (offreTrouvee.partages_autorises || 0) : 1;

        let nouvelleDate = new Date();
        nouvelleDate.setDate(nouvelleDate.getDate() + 31);

        // 4. Mise à jour finale du lecteur
        await supabaseAdmin.from('lecteurs').update({
            est_abonne: true,
            fin_abonnement: nouvelleDate.toISOString(),
            credits_partage: partagesDefinis
        }).eq('email', emailClient);
    }

    return { statusCode: 200, body: 'Webhook traité avec succès, crédits attribués !' };
};

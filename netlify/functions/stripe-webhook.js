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

    // 1️⃣ CAS N°1 : NOUVEL ABONNEMENT
    if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object;
        const emailClient = session.customer_details.email;
        
        // Trouver l'offre pour connaître le nombre de partages
        const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] });
        const priceId = sessionWithLineItems.line_items.data[0].price.id;
        const { data: offre } = await supabaseAdmin.from('offres').select('partages_autorises').eq('stripe_price_id', priceId).single();
        const partagesDefinis = offre ? (offre.partages_autorises || 0) : 0;

        let nouvelleDate = new Date();
        nouvelleDate.setDate(nouvelleDate.getDate() + 31);

        await supabaseAdmin.from('lecteurs').update({
            est_abonne: true,
            fin_abonnement: nouvelleDate.toISOString(),
            credits_partage: partagesDefinis // Initialisation du quota
        }).eq('email', emailClient);
    }

    // 2️⃣ CAS N°2 : RENOUVELLEMENT MENSUEL AUTOMATIQUE
    if (stripeEvent.type === 'invoice.paid') {
        const invoice = stripeEvent.data.object;
        const emailClient = invoice.customer_email;
        
        // On récupère l'offre liée à cette facture mensuelle
        const priceId = invoice.lines.data[0].price.id;
        const { data: offre } = await supabaseAdmin.from('offres').select('partages_autorises').eq('stripe_price_id', priceId).single();
        const partagesDefinis = offre ? (offre.partages_autorises || 0) : 0;

        let nouvelleDate = new Date();
        nouvelleDate.setDate(nouvelleDate.getDate() + 31); // On rajoute 1 mois

        // On met à jour la date ET on remet les crédits à neuf !
        await supabaseAdmin.from('lecteurs').update({
            est_abonne: true,
            fin_abonnement: nouvelleDate.toISOString(),
            credits_partage: partagesDefinis // Remise à zéro du quota mensuel
        }).eq('email', emailClient);
    }

    return { statusCode: 200, body: 'Événement Stripe traité avec succès !' };
};

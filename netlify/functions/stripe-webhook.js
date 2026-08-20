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

    if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object;
        const emailClient = session.customer_details.email;
        
        const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

        // 1. Récupérer le lien de l'offre achetée (price_id) depuis Stripe
        const sessionWithLineItems = await stripe.checkout.sessions.retrieve(
            session.id,
            { expand: ['line_items'] }
        );
        const priceId = sessionWithLineItems.line_items.data[0].price.id;

        // 2. Trouver cette offre dans Supabase pour lire son nombre de partages
        const { data: offre } = await supabaseAdmin.from('offres').select('partages_autorises').eq('stripe_price_id', priceId).single();
        const partagesDefinis = offre ? (offre.partages_autorises || 0) : 0;

        let nouvelleDate = new Date();
        nouvelleDate.setDate(nouvelleDate.getDate() + 31);

        // 3. Mettre à jour le lecteur avec le BON nombre
        await supabaseAdmin.from('lecteurs').update({
            est_abonne: true,
            fin_abonnement: nouvelleDate.toISOString(),
            credits_partage: partagesDefinis
        }).eq('email', emailClient);
    }

    return { statusCode: 200, body: 'Paiement reçu et compte mis à jour !' };
};

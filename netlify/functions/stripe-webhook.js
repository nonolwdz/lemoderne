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

        let nouvelleDate = new Date();
        nouvelleDate.setDate(nouvelleDate.getDate() + 31);

        await supabaseAdmin.from('lecteurs').update({
            est_abonne: true,
            fin_abonnement: nouvelleDate.toISOString(),
            credits_partage: 2
        }).eq('email', emailClient);
    }

    return { statusCode: 200, body: 'Paiement reçu et compte mis à jour !' };
};

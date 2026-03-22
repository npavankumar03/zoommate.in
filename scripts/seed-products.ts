import { getUncachableStripeClient } from '../server/stripeClient';

async function seedProducts() {
  const stripe = await getUncachableStripeClient();

  console.log('Checking for existing Zoom Mate products...');
  const existing = await stripe.products.search({ query: "name:'Zoom Mate'" });
  if (existing.data.length > 0) {
    console.log('Zoom Mate products already exist, skipping seed.');
    console.log('Existing products:');
    for (const p of existing.data) {
      console.log(`  - ${p.name} (${p.id})`);
    }
    return;
  }

  console.log('Creating Zoom Mate subscription products...');

  const freePlan = await stripe.products.create({
    name: 'Zoom Mate Free',
    description: 'Perfect for testing or quick help. 5 free minutes per hour.',
    metadata: {
      plan: 'free',
      tier: '0',
      features: 'Real-time Transcription,Instant AI Responses,Invisible to screen sharing,Screen Analyzer,Custom Knowledge Support,Customized Response Formats',
    },
  });
  console.log(`Created: ${freePlan.name} (${freePlan.id})`);

  const freePrice = await stripe.prices.create({
    product: freePlan.id,
    unit_amount: 0,
    currency: 'usd',
    recurring: { interval: 'month' },
  });
  console.log(`  Price: $0/month (${freePrice.id})`);

  const standardPlan = await stripe.products.create({
    name: 'Zoom Mate Standard',
    description: 'Best for interviews and important calls. $14.99 per hour of active usage.',
    metadata: {
      plan: 'standard',
      tier: '1',
      popular: 'true',
      features: 'Real-time Transcription,Instant AI Responses,Invisible to screen sharing,Screen Analyzer,Custom Knowledge Support,Customized Response Formats,Priority Support,Minutes never expire',
    },
  });
  console.log(`Created: ${standardPlan.name} (${standardPlan.id})`);

  const standardMonthlyPrice = await stripe.prices.create({
    product: standardPlan.id,
    unit_amount: 1499,
    currency: 'usd',
    recurring: { interval: 'month' },
  });
  console.log(`  Price: $14.99/month (${standardMonthlyPrice.id})`);

  const enterprisePlan = await stripe.products.create({
    name: 'Zoom Mate Enterprise',
    description: 'Built for teams and high-volume users. Custom pricing.',
    metadata: {
      plan: 'enterprise',
      tier: '2',
      features: 'All Professional Features,Custom Integrations,Enterprise-grade Security,Invite team members,Dedicated Account Manager,Minutes never expire',
    },
  });
  console.log(`Created: ${enterprisePlan.name} (${enterprisePlan.id})`);

  const enterprisePrice = await stripe.prices.create({
    product: enterprisePlan.id,
    unit_amount: 4999,
    currency: 'usd',
    recurring: { interval: 'month' },
  });
  console.log(`  Price: $49.99/month (${enterprisePrice.id})`);

  console.log('\nAll products created successfully!');
  console.log('\nProduct IDs for reference:');
  console.log(`  Free: ${freePlan.id} | Price: ${freePrice.id}`);
  console.log(`  Standard: ${standardPlan.id} | Price: ${standardMonthlyPrice.id}`);
  console.log(`  Enterprise: ${enterprisePlan.id} | Price: ${enterprisePrice.id}`);
}

seedProducts().catch(console.error);

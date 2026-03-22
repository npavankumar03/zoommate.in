import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery } from "@tanstack/react-query";
import {
  Mic, Monitor, Zap, Eye, Shield, Clock, CreditCard, Sparkles,
  ChevronDown, ChevronUp, Check, X, ArrowRight, MessageSquare,
  FileText, Upload, Play, Users, Star, Headphones, MonitorSmartphone,
  Download, BookOpen, Search, Target, AlertCircle, Shuffle
} from "lucide-react";
import { motion } from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

function Navbar() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold" data-testid="text-logo">Zoom Mate</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <button onClick={() => scrollTo("how-it-works")} className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-how-it-works">How it Works</button>
            <button onClick={() => scrollTo("features")} className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-features">Features</button>
            <button onClick={() => scrollTo("comparison")} className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-comparison">Comparison</button>
            <button onClick={() => scrollTo("pricing")} className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-pricing">Pricing</button>
            <button onClick={() => scrollTo("faq")} className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-faq">FAQ</button>
            <button onClick={() => scrollTo("download")} className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-download">Download</button>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login">
              <Button variant="ghost" size="sm" data-testid="button-signin">Sign in</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm" data-testid="button-signup">
                Get Started
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

function HeroSection() {
  return (
    <section className="relative pt-32 pb-20 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
      <div className="absolute top-20 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute top-40 right-1/4 w-72 h-72 bg-chart-2/10 rounded-full blur-3xl" />
      <div className="absolute bottom-10 left-1/2 w-64 h-64 bg-chart-5/8 rounded-full blur-3xl" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="text-center max-w-4xl mx-auto"
        >
          <motion.div variants={fadeUp}>
            <Badge variant="secondary" className="mb-6">
              <Sparkles className="w-3 h-3 mr-1" />
              AI-Powered Interview Assistant
            </Badge>
          </motion.div>
          <motion.h1
            variants={fadeUp}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-tight"
            data-testid="text-hero-title"
          >
            Answer every question in your next{" "}
            <span className="bg-gradient-to-r from-primary via-chart-2 to-chart-5 bg-clip-text text-transparent">
              interview
            </span>
          </motion.h1>
          <motion.p
            variants={fadeUp}
            className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
            data-testid="text-hero-description"
          >
            Zoom Mate listens to your conversation, sees your screen and provides instant AI-powered responses exactly when you need them.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup">
              <Button size="lg" className="text-base px-8" data-testid="button-hero-cta">
                Try Zoom Mate Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <Badge variant="outline" className="text-muted-foreground">
              <Clock className="w-3 h-3 mr-1" />
              5 free minutes every hour
            </Badge>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-16 max-w-5xl mx-auto"
        >
          <div className="rounded-xl border bg-gradient-to-b from-primary/20 to-transparent p-1">
            <div className="bg-card rounded-md p-6 sm:p-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="flex flex-col items-center text-center p-4" data-testid="card-feature-listening">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-3">
                    <Mic className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-sm">Real-time Listening</h3>
                  <p className="text-xs text-muted-foreground mt-1">Captures every word in your conversation</p>
                </div>
                <div className="flex flex-col items-center text-center p-4" data-testid="card-feature-screen">
                  <div className="w-12 h-12 rounded-md bg-chart-2/10 flex items-center justify-center mb-3">
                    <Monitor className="w-6 h-6 text-chart-2" />
                  </div>
                  <h3 className="font-semibold text-sm">Screen Analysis</h3>
                  <p className="text-xs text-muted-foreground mt-1">Sees what you see for context-aware answers</p>
                </div>
                <div className="flex flex-col items-center text-center p-4" data-testid="card-feature-responses">
                  <div className="w-12 h-12 rounded-md bg-chart-3/10 flex items-center justify-center mb-3">
                    <Zap className="w-6 h-6 text-chart-3" />
                  </div>
                  <h3 className="font-semibold text-sm">Instant Responses</h3>
                  <p className="text-xs text-muted-foreground mt-1">Get perfect answers exactly when needed</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function PainPointsSection() {
  const painPoints = [
    { num: "01", title: "Your Mind Goes Blank", desc: "Someone asks a tough question and suddenly you can't think. You freeze. You stutter.", icon: AlertCircle },
    { num: "02", title: "You Ramble and Ramble", desc: "You start answering but can't find the point. Three minutes later, everyone looks confused.", icon: MessageSquare },
    { num: "03", title: "You Forget Important Details", desc: "The interviewer asks for that one metric. You know you prepared it. But right now? Gone.", icon: BookOpen },
    { num: "04", title: "You Waste Time Searching", desc: "While everyone waits, you're frantically searching your documents. The moment passes.", icon: Search },
  ];

  return (
    <section className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold" data-testid="text-pain-title">
            We've All Been There...
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
            Your mind goes blank. You forget what you wanted to say. Everyone's waiting for your answer.
          </motion.p>
        </motion.div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {painPoints.map((point, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="p-6 h-full hover-elevate" data-testid={`card-pain-${i}`}>
                <span className="text-4xl font-bold text-primary/20">{point.num}</span>
                <point.icon className="w-5 h-5 text-muted-foreground mt-2 mb-1" />
                <h3 className="font-semibold mt-2 mb-2">{point.title}</h3>
                <p className="text-sm text-muted-foreground">{point.desc}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    { icon: Target, title: "Pick Your Copilot", desc: "Choose the type of assistance you need -- interview prep, sales call support, or general meeting help. Zoom Mate adapts to your scenario.", color: "text-primary", bg: "bg-primary/10" },
    { icon: Upload, title: "Add Meeting Data", desc: "Upload your resume, job descriptions, product docs, or talking points. Zoom Mate learns your story so it can give you personalized answers.", color: "text-chart-2", bg: "bg-chart-2/10" },
    { icon: Play, title: "Launch and Go", desc: "Start your session and Zoom Mate runs invisibly in the background. It listens, analyzes, and delivers the perfect response in real time.", color: "text-chart-3", bg: "bg-chart-3/10" },
  ];

  return (
    <section id="how-it-works" className="py-20 bg-card/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold" data-testid="text-how-title">
            How It Works
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground text-lg">
            Get started in three simple steps. No complicated setup required.
          </motion.p>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
            >
              <Card className="p-8 text-center h-full" data-testid={`card-step-${i}`}>
                <div className="flex justify-center mb-6">
                  <Badge variant="outline" className="text-xs px-3">Step {i + 1}</Badge>
                </div>
                <div className={`w-16 h-16 rounded-md ${step.bg} flex items-center justify-center mx-auto mb-4`}>
                  <step.icon className={`w-8 h-8 ${step.color}`} />
                </div>
                <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{step.desc}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SolutionSection() {
  return (
    <section className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="text-center max-w-3xl mx-auto"
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold" data-testid="text-solution-title">
            Zoom Mate Gives You The Perfect Answer
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground text-lg leading-relaxed">
            Zoom Mate listens to your conversation, analyzes your screen, and tells you exactly what to say. No more freezing, no more rambling, no more missed opportunities.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup">
              <Button size="lg" data-testid="button-solution-cta">
                Get Started Now
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    { icon: Monitor, title: "Sees Your Screen", desc: "It analyzes everything on your screen so you get answers based on what you're both looking at.", color: "text-primary" },
    { icon: Shuffle, title: "Switch Styles Anytime", desc: "Need a quick answer? Use short mode. Want a detailed story? Switch to STAR format.", color: "text-chart-4" },
    { icon: Mic, title: "Listens Everything", desc: "Zoom Mate listens to the entire conversation -- your answers, their follow-ups, all the context.", color: "text-chart-2" },
    { icon: CreditCard, title: "Pay for What You Use", desc: "No expensive monthly subscriptions. No wasted credits. Pay only for the minutes you actually use.", color: "text-chart-3" },
    { icon: Shield, title: "Invisible to Everyone", desc: "Completely hidden when you share your screen. Nobody sees it, nobody knows you're using it.", color: "text-chart-5" },
    { icon: FileText, title: "Custom Knowledge", desc: "Upload your resume, job descriptions, notes, or any information. It learns YOUR story.", color: "text-primary" },
  ];

  return (
    <section id="features" className="py-20 bg-card/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold" data-testid="text-features-title">
            Why You'll Never Go Back
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground text-lg">
            Zoom Mate works differently than every other tool -- and that's the point.
          </motion.p>
        </motion.div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
            >
              <Card className="p-6 h-full hover-elevate" data-testid={`card-feature-${i}`}>
                <feature.icon className={`w-8 h-8 ${feature.color} mb-4`} />
                <h3 className="font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.desc}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ComparisonSection() {
  const featureList = [
    "Listens to entire conversation",
    "Multiple response types",
    "Pay only for what you use",
    "Custom knowledge",
    "Structured templates (STAR)",
    "Works for interviews/sales/meetings",
    "Invisible to screen sharing",
    "Screen analyzer for coding",
    "Works on mobile",
    "Free to start",
  ];

  const competitors = [
    { name: "Zoom Mate", checks: [true, true, true, true, true, true, true, true, true, true] },
    { name: "Final Round AI", checks: [false, false, false, true, true, true, true, false, false, false] },
    { name: "Cluely", checks: [true, false, false, true, false, true, true, true, false, false] },
    { name: "Parakeet AI", checks: [false, false, false, true, false, true, true, false, true, false] },
  ];

  return (
    <section id="comparison" className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold" data-testid="text-comparison-title">
            How We Compare
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground text-lg">
            See why smart people choose Zoom Mate over everything else.
          </motion.p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <Card className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-comparison">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-4 font-semibold">Features</th>
                  {competitors.map((c) => (
                    <th key={c.name} className={`p-4 font-semibold text-center ${c.name === "Zoom Mate" ? "text-primary" : "text-muted-foreground"}`}>
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {featureList.map((feature, fi) => (
                  <tr key={fi} className="border-b last:border-b-0">
                    <td className="p-4 text-muted-foreground">{feature}</td>
                    {competitors.map((c) => (
                      <td key={c.name} className="p-4 text-center">
                        {c.checks[fi] ? (
                          <Check className={`w-5 h-5 mx-auto ${c.name === "Zoom Mate" ? "text-primary" : "text-chart-3"}`} />
                        ) : (
                          <X className="w-5 h-5 mx-auto text-muted-foreground/30" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </motion.div>
      </div>
    </section>
  );
}

function PricingSection() {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["/api/stripe/products"],
  });

  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "Free 5 Min Per Hour",
      desc: "Perfect for testing or quick help.",
      cta: "Get Started",
      features: ["Real-time Transcription", "Instant AI Responses", "Invisible to screen sharing", "Screen Analyzer", "Custom Knowledge Support", "Customized Response Formats"],
      popular: false,
      stripePlan: "free",
    },
    {
      name: "Standard",
      price: "$14.99",
      period: "Per Month",
      desc: "Best for interviews and important calls.",
      cta: "Subscribe Now",
      features: ["Real-time Transcription", "Instant AI Responses", "Invisible to screen sharing", "Screen Analyzer", "Custom Knowledge Support", "Customized Response Formats", "Priority Support", "Minutes never expire"],
      popular: true,
      stripePlan: "standard",
    },
    {
      name: "Enterprise",
      price: "$49.99",
      period: "Per Month",
      desc: "Built for teams and high-volume users.",
      cta: "Subscribe Now",
      features: ["All Professional Features", "Custom Integrations", "Enterprise-grade Security", "Invite team members", "Dedicated Account Manager", "Minutes never expire"],
      popular: false,
      stripePlan: "enterprise",
    },
  ];

  const handleSubscribe = async (stripePlan: string) => {
    if (stripePlan === "free") {
      window.location.href = "/signup";
      return;
    }

    const product = products.find((p: any) =>
      p.metadata && typeof p.metadata === 'object' && (p.metadata as any).plan === stripePlan
    );
    if (!product || !product.prices || product.prices.length === 0) {
      window.location.href = "/signup";
      return;
    }

    setLoadingPlan(stripePlan);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ priceId: product.prices[0].id }),
      });
      if (res.status === 401) {
        window.location.href = "/signup";
        return;
      }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      window.location.href = "/signup";
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <section id="pricing" className="py-20 bg-card/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold" data-testid="text-pricing-title">
            Simple Usage Pricing
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground text-lg">
            Pay only for active assist minutes. Purchased minutes never expire. No lock-in.
          </motion.p>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className={`p-6 h-full flex flex-col relative ${plan.popular ? "border-primary" : ""}`} data-testid={`card-pricing-${plan.name.toLowerCase()}`}>
                {plan.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most Popular</Badge>
                )}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <div className="mt-3 flex items-baseline gap-1 flex-wrap">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    {plan.price !== "$0" && (
                      <span className="text-sm text-muted-foreground">/ {plan.period}</span>
                    )}
                    {plan.price === "$0" && (
                      <span className="text-sm text-muted-foreground">{plan.period}</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">{plan.desc}</p>
                </div>
                <Button
                  className="w-full"
                  variant={plan.popular ? "default" : "outline"}
                  onClick={() => handleSubscribe(plan.stripePlan)}
                  disabled={loadingPlan === plan.stripePlan}
                  data-testid={`button-pricing-${plan.name.toLowerCase()}`}
                >
                  {loadingPlan === plan.stripePlan ? "Loading..." : plan.cta}
                </Button>
                <ul className="mt-6 space-y-3 flex-1">
                  {plan.features.map((feature, fi) => (
                    <li key={fi} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialsSection() {
  const testimonials = [
    { quote: "In my interview I got two questions I hadn't prepped for. Zoom Mate surfaced a clear outline in seconds so I stayed calm. I got the offer.", name: "Sarah M.", role: "Software Engineer" },
    { quote: "During a sales demo, I forgot the specific numbers the client asked about. Zoom Mate pulled up the right stats instantly. We closed the deal.", name: "James K.", role: "Sales Director" },
    { quote: "I used to spend 30 minutes prepping for every standup. Now I just upload my notes and Zoom Mate handles the rest perfectly.", name: "Priya R.", role: "Product Manager" },
  ];

  return (
    <section className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold" data-testid="text-testimonials-title">
            What Our Users Say
          </motion.h2>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="p-6 h-full flex flex-col" data-testid={`card-testimonial-${i}`}>
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, si) => (
                    <Star key={si} className="w-4 h-4 text-chart-4 fill-chart-4" />
                  ))}
                </div>
                <p className="text-sm leading-relaxed flex-1 italic text-muted-foreground">"{t.quote}"</p>
                <div className="mt-4 pt-4 border-t">
                  <p className="font-semibold text-sm">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const faqs = [
    {
      question: "How does Zoom Mate work during an interview?",
      answer: "Zoom Mate runs invisibly on your desktop. It listens to the conversation in real time, analyzes your screen for context, and provides instant suggested responses that appear on your screen. You simply read or adapt the suggestions as you speak.",
    },
    {
      question: "Is Zoom Mate detectable during screen sharing?",
      answer: "No. Zoom Mate is designed to be completely invisible during screen sharing. It uses a special overlay that is not captured by screen sharing software, so your interviewer or meeting participants will never see it.",
    },
    {
      question: "What platforms does Zoom Mate support?",
      answer: "Zoom Mate works on Windows and macOS as a desktop application. It is compatible with all major meeting platforms including Zoom, Google Meet, Microsoft Teams, and more. A mobile version is also available for on-the-go use.",
    },
    {
      question: "How is pricing calculated?",
      answer: "You only pay for active assist minutes. The free tier gives you 5 minutes per hour at no cost. The Standard plan is $14.99 per hour of active usage, and purchased minutes never expire. There are no monthly subscriptions or hidden fees.",
    },
    {
      question: "Can I upload my own documents and knowledge?",
      answer: "Yes. You can upload your resume, job descriptions, product documentation, talking points, and any other materials. Zoom Mate uses this custom knowledge to provide personalized, contextually relevant answers during your sessions.",
    },
  ];

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="py-20 bg-card/50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="text-center mb-16"
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold" data-testid="text-faq-title">
            Frequently Asked Questions
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground text-lg">
            Everything you need to know about Zoom Mate.
          </motion.p>
        </motion.div>
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="overflow-visible">
                <button
                  onClick={() => toggle(i)}
                  className="w-full flex items-center justify-between gap-4 p-5 text-left"
                  data-testid={`button-faq-${i}`}
                >
                  <span className="font-medium text-sm">{faq.question}</span>
                  {openIndex === i ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </button>
                {openIndex === i && (
                  <div className="px-5 pb-5">
                    <p className="text-sm text-muted-foreground leading-relaxed">{faq.answer}</p>
                  </div>
                )}
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DownloadCTASection() {
  return (
    <section id="download" className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="text-center"
        >
          <motion.div variants={fadeUp}>
            <div className="rounded-xl border bg-gradient-to-br from-primary/10 via-chart-2/5 to-chart-5/10 p-10 sm:p-16">
              <div className="w-16 h-16 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Download className="w-8 h-8 text-primary" />
              </div>
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-1.5 rounded-full mb-4">
                🚀 Coming Soon
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold mb-4" data-testid="text-download-title">
                Desktop App Coming Soon
              </h2>
              <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-8">
                The Zoom Mate desktop app is under development. Use Zoom Mate in your browser right now while we finish the desktop experience.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" className="text-base px-8 opacity-50 cursor-not-allowed" disabled data-testid="button-download-cta">
                  <Download className="w-4 h-4 mr-2" />
                  Download for Desktop
                </Button>
                <Link href="/signup">
                  <Button size="lg" variant="outline" data-testid="button-download-web">
                    Try in Browser
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t py-16 bg-card/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold" data-testid="text-footer-logo">Zoom Mate</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              AI-powered interview assistant that helps you answer every question with confidence.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Product</h4>
            <ul className="space-y-2">
              <li><button onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })} className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-features">Features</button></li>
              <li><button onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })} className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-pricing">Pricing</button></li>
              <li><button onClick={() => document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" })} className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-faq">FAQ</button></li>
              <li><Link href="/download" className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-download">Download</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Legal</h4>
            <ul className="space-y-2">
              <li><Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-privacy">Privacy Policy</Link></li>
              <li><Link href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-terms">Terms of Service</Link></li>
              <li><Link href="/refund" className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-footer-refund">Refund Policy</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Compare</h4>
            <ul className="space-y-2">
              <li><span className="text-xs text-muted-foreground">vs Final Round AI</span></li>
              <li><span className="text-xs text-muted-foreground">vs Cluely</span></li>
              <li><span className="text-xs text-muted-foreground">vs Parakeet AI</span></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t text-center">
          <p className="text-xs text-muted-foreground" data-testid="text-copyright">
            2025 Zoom Mate. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <HeroSection />
      <PainPointsSection />
      <HowItWorksSection />
      <SolutionSection />
      <FeaturesSection />
      <ComparisonSection />
      <PricingSection />
      <TestimonialsSection />
      <FAQSection />
      <DownloadCTASection />
      <Footer />
    </div>
  );
}

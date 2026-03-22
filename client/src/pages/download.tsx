import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import { Zap, ArrowLeft, Monitor, Laptop, Download as DownloadIcon, Check, Shield, Globe, Apple, Bell } from "lucide-react";
import { motion } from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

export default function Download() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [notified, setNotified] = useState<Record<string, boolean>>({});

  const handleNotify = (platform: string) => {
    if (!email.trim()) {
      toast({ title: "Please enter your email", description: "We'll notify you when the desktop app is available.", variant: "destructive" });
      return;
    }
    setNotified((prev) => ({ ...prev, [platform]: true }));
    toast({ title: `You'll be notified!`, description: `We'll email you at ${email} when the ${platform} app is ready.` });
  };

  const platforms = [
    {
      name: "Windows",
      icon: Monitor,
      version: "Coming Soon",
      requirements: "Windows 10 or later",
      desc: "Transparent overlay with system audio capture",
    },
    {
      name: "macOS",
      icon: Apple,
      version: "Coming Soon",
      requirements: "macOS 12.0 or later",
      desc: "Native overlay invisible to screen sharing",
    },
    {
      name: "Linux",
      icon: Laptop,
      version: "Coming Soon",
      requirements: "Ubuntu 20.04+ / Fedora 36+",
      desc: "X11/Wayland overlay with PulseAudio capture",
    },
  ];

  const features = [
    { icon: Shield, title: "Screen Share Invisible", desc: "Uses OS-level window flags to hide from screen sharing and recording. Interviewers never see it." },
    { icon: Monitor, title: "System Audio Capture", desc: "Captures meeting audio directly from your system for the most accurate real-time transcription." },
    { icon: Globe, title: "Works Everywhere", desc: "Compatible with Zoom, Google Meet, Teams, WebEx, and any meeting platform in any browser." },
  ];

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4 h-16">
            <Link href="/">
              <div className="flex items-center gap-2 cursor-pointer">
                <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
                  <Zap className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="text-lg font-bold" data-testid="text-logo">Zoom Mate</span>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="button-back-home">
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <div className="pt-32 pb-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            className="text-center mb-16"
          >
            <Badge variant="secondary" className="mb-6">
              <DownloadIcon className="w-3 h-3 mr-1" />
              Desktop App
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4" data-testid="text-download-title">
              Desktop App Coming Soon
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
              The Zoom Mate desktop app will be completely invisible during screen sharing.
              Enter your email to be notified when it launches.
            </p>
            <div className="flex items-center justify-center gap-2 max-w-md mx-auto">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                data-testid="input-notify-email"
              />
            </div>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {platforms.map((platform, i) => (
              <motion.div
                key={platform.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className="p-6 h-full flex flex-col text-center" data-testid={`card-platform-${platform.name.toLowerCase()}`}>
                  <div className="w-16 h-16 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <platform.icon className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-1">{platform.name}</h3>
                  <Badge variant="outline" className="text-xs mx-auto mb-3">{platform.version}</Badge>
                  <p className="text-xs text-muted-foreground mb-2">{platform.requirements}</p>
                  <p className="text-sm text-muted-foreground mb-6">{platform.desc}</p>
                  <div className="mt-auto">
                    {notified[platform.name] ? (
                      <Button className="w-full" variant="outline" disabled data-testid={`button-notified-${platform.name.toLowerCase()}`}>
                        <Check className="w-4 h-4 mr-2" />
                        You'll be notified
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        onClick={() => handleNotify(platform.name)}
                        data-testid={`button-notify-${platform.name.toLowerCase()}`}
                      >
                        <Bell className="w-4 h-4 mr-2" />
                        Notify Me
                      </Button>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mb-16"
          >
            <h2 className="text-2xl font-bold text-center mb-8">Why Use the Desktop App?</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {features.map((feature, i) => (
                <Card key={i} className="p-6 hover-elevate">
                  <feature.icon className="w-8 h-8 text-primary mb-4" />
                  <h3 className="font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.desc}</p>
                </Card>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card className="p-8 text-center">
              <Laptop className="w-12 h-12 text-primary mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Use in Browser Right Now</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Don't wait for the desktop app. Zoom Mate works in your browser today with real-time speech recognition and AI responses.
              </p>
              <Link href="/signup">
                <Button variant="outline" data-testid="button-use-browser">
                  Start Using in Browser
                </Button>
              </Link>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

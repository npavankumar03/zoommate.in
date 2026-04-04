import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, ArrowRight, Eye, EyeOff, Mail, RefreshCw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

export function LoginPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      const messages: Record<string, string> = {
        google_no_code: "Google sign-in was cancelled.",
        google_token_failed: "Failed to connect with Google. Please try again.",
        google_profile_failed: "Could not retrieve your Google profile.",
        google_auth_failed: "Google sign-in failed. Please try again.",
        session_failed: "Sign-in succeeded but session creation failed.",
      };
      toast({ title: "Sign-in error", description: messages[error] || "An error occurred.", variant: "destructive" });
    }
  }, []);

  const loginMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.role === "admin") {
        navigate("/admin");
      } else {
        navigate("/dashboard");
      }
    },
    onError: (error: Error) => {
      if (error.message.includes("verify your email")) {
        toast({ title: "Email not verified", description: "Please check your inbox for the verification code.", variant: "destructive" });
        navigate(`/verify?username=${encodeURIComponent(username)}`);
        return;
      }
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ username, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-chart-2/5" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm relative"
      >
        <div className="text-center mb-8">
          <Link href="/">
            <div className="inline-flex items-center gap-2 mb-4 cursor-pointer">
              <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold">Zoom Mate</span>
            </div>
          </Link>
          <h1 className="text-2xl font-bold" data-testid="text-login-title">Welcome back</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your account</p>
        </div>
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                data-testid="input-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loginMutation.isPending} data-testid="button-login">
              {loginMutation.isPending ? "Signing in..." : "Sign in"}
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </form>
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or</span></div>
          </div>
          <a href="/auth/google" className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </a>
        </Card>
        <p className="text-center text-sm text-muted-foreground mt-4">
          Don't have an account?{" "}
          <Link href="/signup" className="text-primary font-medium" data-testid="link-signup">
            Sign up
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

export function SignupPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [verificationStep, setVerificationStep] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");

  const signupMutation = useMutation({
    mutationFn: async (data: { username: string; password: string; email: string }) => {
      const res = await apiRequest("POST", "/api/auth/signup", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.requiresVerification) {
        setVerificationStep(true);
        toast({ title: "Verification email sent", description: "Check your inbox for the 6-digit code." });
      } else {
        navigate("/dashboard");
      }
    },
    onError: (error: Error) => {
      toast({ title: "Signup failed", description: error.message, variant: "destructive" });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (data: { username: string; code: string }) => {
      const res = await apiRequest("POST", "/api/auth/verify-email", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email verified!" });
      navigate("/dashboard");
    },
    onError: (error: Error) => {
      toast({ title: "Verification failed", description: error.message, variant: "destructive" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (data: { username: string }) => {
      const res = await apiRequest("POST", "/api/auth/resend-verification", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Code resent", description: "Check your inbox for the new 6-digit code." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to resend", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    signupMutation.mutate({ username, password, email });
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    verifyMutation.mutate({ username, code: verificationCode });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-chart-2/5" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm relative"
      >
        <div className="text-center mb-8">
          <Link href="/">
            <div className="inline-flex items-center gap-2 mb-4 cursor-pointer">
              <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold">Zoom Mate</span>
            </div>
          </Link>
          {verificationStep ? (
            <>
              <h1 className="text-2xl font-bold">Verify your email</h1>
              <p className="text-sm text-muted-foreground mt-1">We sent a 6-digit code to <strong>{email}</strong></p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold" data-testid="text-signup-title">Create your account</h1>
              <p className="text-sm text-muted-foreground mt-1">Start using Zoom Mate for free</p>
            </>
          )}
        </div>
        <Card className="p-6">
          {verificationStep ? (
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Mail className="w-6 h-6 text-primary" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="verification-code">Verification Code</Label>
                <Input
                  id="verification-code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="Enter 6-digit code"
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                  maxLength={6}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={verifyMutation.isPending || verificationCode.length !== 6}>
                {verifyMutation.isPending ? "Verifying..." : "Verify Email"}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => resendMutation.mutate({ username })}
                  disabled={resendMutation.isPending}
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${resendMutation.isPending ? "animate-spin" : ""}`} />
                  {resendMutation.isPending ? "Sending..." : "Resend code"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-username">Username</Label>
                  <Input
                    id="signup-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Choose a username"
                    required
                    data-testid="input-signup-username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    data-testid="input-signup-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="signup-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a password (min 6 chars)"
                      required
                      data-testid="input-signup-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={signupMutation.isPending} data-testid="button-signup-submit">
                  {signupMutation.isPending ? "Creating account..." : "Create account"}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </form>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or</span></div>
              </div>
              <a href="/auth/google" className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
                <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </a>
            </>
          )}
        </Card>
        <p className="text-center text-sm text-muted-foreground mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-medium" data-testid="link-login">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

export function VerifyPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const params = new URLSearchParams(window.location.search);
  const [username, setUsername] = useState(params.get("username") || "");
  const [verificationCode, setVerificationCode] = useState("");

  const verifyMutation = useMutation({
    mutationFn: async (data: { username: string; code: string }) => {
      const res = await apiRequest("POST", "/api/auth/verify-email", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email verified!" });
      navigate("/dashboard");
    },
    onError: (error: Error) => {
      toast({ title: "Verification failed", description: error.message, variant: "destructive" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (data: { username: string }) => {
      const res = await apiRequest("POST", "/api/auth/resend-verification", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Code resent", description: "Check your inbox for the new code." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to resend", description: error.message, variant: "destructive" });
    },
  });

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    verifyMutation.mutate({ username, code: verificationCode });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-chart-2/5" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm relative"
      >
        <div className="text-center mb-8">
          <Link href="/">
            <div className="inline-flex items-center gap-2 mb-4 cursor-pointer">
              <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold">Zoom Mate</span>
            </div>
          </Link>
          <h1 className="text-2xl font-bold">Verify your email</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter the 6-digit code sent to your email</p>
        </div>
        <Card className="p-6">
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="flex justify-center mb-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="w-6 h-6 text-primary" />
              </div>
            </div>
            {!params.get("username") && (
              <div className="space-y-2">
                <Label htmlFor="verify-username">Username</Label>
                <Input
                  id="verify-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your username"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="verify-code">Verification Code</Label>
              <Input
                id="verify-code"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Enter 6-digit code"
                className="text-center text-2xl tracking-[0.5em] font-mono"
                maxLength={6}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={verifyMutation.isPending || verificationCode.length !== 6 || !username}>
              {verifyMutation.isPending ? "Verifying..." : "Verify Email"}
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => username && resendMutation.mutate({ username })}
                disabled={resendMutation.isPending || !username}
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${resendMutation.isPending ? "animate-spin" : ""}`} />
                {resendMutation.isPending ? "Sending..." : "Resend code"}
              </button>
            </div>
          </form>
        </Card>
        <p className="text-center text-sm text-muted-foreground mt-4">
          <Link href="/login" className="text-primary font-medium">Back to login</Link>
        </p>
      </motion.div>
    </div>
  );
}

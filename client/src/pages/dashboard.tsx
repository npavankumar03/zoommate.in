import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Meeting, Document, Assistant, CreditLog } from "@shared/schema";
import {
  Zap, Plus, Minus, FileText, Play, Clock, Mic, Briefcase, GraduationCap,
  Users, Gamepad2, Trash2, Upload, ArrowRight, LogOut,
  FolderOpen, Settings, Code, MessageSquare, Shield, CreditCard, ExternalLink, Loader2,
  Monitor, ScreenShare, Search, Filter, Pencil, UserRound, KeyRound, ChevronDown, CheckCircle2,
  Phone, Timer, Flame, Download
} from "lucide-react";
import { motion } from "framer-motion";

type AccountUser = {
  id: string;
  username: string;
  role: string;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  plan?: string | null;
  minutesUsed?: number;
  minutesPurchased?: number;
  referralCredits?: number;
};

const MINUTE_PRICING = [
  { minutes: 60, amountCents: 1199 },
  { minutes: 30, amountCents: 599 },
  { minutes: 10, amountCents: 249 },
] as const;

function resolveMinutePrice(minutesRequested: number) {
  if (!Number.isFinite(minutesRequested) || minutesRequested <= 0 || minutesRequested % 10 !== 0) {
    return 0;
  }

  const dp = new Array<number>(minutesRequested + 1).fill(Number.POSITIVE_INFINITY);
  dp[0] = 0;

  for (let total = 10; total <= minutesRequested; total += 10) {
    for (const pack of MINUTE_PRICING) {
      if (total >= pack.minutes) {
        dp[total] = Math.min(dp[total], dp[total - pack.minutes] + pack.amountCents);
      }
    }
  }

  return Number.isFinite(dp[minutesRequested]) ? dp[minutesRequested] : 0;
}

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatLogType(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: unknown) {
  if (!value) return "-";
  const parsed = new Date(value as any);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function rangeLabel(count: number, noun: string) {
  if (count <= 0) return `Showing 0-0 of 0 ${noun}`;
  return `Showing 1-${count} of ${count} ${noun}`;
}

function AccountCenterDialog({
  user,
  open,
  onOpenChange,
  onLogout,
}: {
  user?: AccountUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogout: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState("profile");
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedMinutes, setSelectedMinutes] = useState(10);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [confirmingPurchase, setConfirmingPurchase] = useState(false);

  useEffect(() => {
    setFirstName(user?.firstName || "");
    setLastName(user?.lastName || "");
  }, [open, user?.firstName, user?.lastName]);

  const { data: creditLogs = [] } = useQuery<CreditLog[]>({
    queryKey: ["/api/account/credit-logs"],
    enabled: open,
  });

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const checkout = params.get("checkout");
    if (params.get("tab") === "minutes") setTab("minutes");
    if (checkout !== "success" || !sessionId || confirmingPurchase) return;

    let active = true;
    (async () => {
      setConfirmingPurchase(true);
      try {
        const res = await apiRequest("POST", "/api/stripe/minutes-confirm", { sessionId });
        const data = await res.json();
        if (!active) return;
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        queryClient.invalidateQueries({ queryKey: ["/api/account/credit-logs"] });
        toast({
          title: "Minutes added",
          description: `${data.minutesAdded} minutes were added to your account.`,
        });
        params.delete("checkout");
        params.delete("session_id");
        const next = params.toString();
        window.history.replaceState({}, "", next ? `${window.location.pathname}?${next}` : window.location.pathname);
      } catch (error: any) {
        if (active) {
          toast({ title: "Failed to confirm purchase", description: error.message, variant: "destructive" });
        }
      } finally {
        if (active) setConfirmingPurchase(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [open, confirmingPurchase, toast]);

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/auth/profile", { firstName, lastName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update profile", description: error.message, variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) {
        throw new Error("New password and confirmation do not match");
      }
      const res = await apiRequest("POST", "/api/auth/change-password", {
        currentPassword,
        newPassword,
      });
      return res.json();
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update password", description: error.message, variant: "destructive" });
    },
  });

  const handleBuyMinutes = async () => {
    setCheckoutLoading(true);
    try {
      const res = await apiRequest("POST", "/api/stripe/minutes-checkout", { minutes: selectedMinutes });
      const data = await res.json();
      if (!data.url) {
        throw new Error("Checkout session was not created");
      }
      window.location.href = data.url;
    } catch (error: any) {
      toast({ title: "Failed to start checkout", description: error.message, variant: "destructive" });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const remainingMinutes = Math.max(
    0,
    (user?.minutesPurchased || 0) + (user?.referralCredits || 0) - (user?.minutesUsed || 0),
  );
  const totalCents = resolveMinutePrice(selectedMinutes);
  const purchaseLogs = creditLogs.filter((log) => log.type === "purchase");
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.username || "Account";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="space-y-1">
            <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">Overview</p>
            <DialogTitle className="text-4xl font-bold tracking-tight">Account</DialogTitle>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <TabsList className="h-auto flex flex-wrap justify-start gap-1 rounded-none border-b bg-transparent p-0">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="minutes">Minutes</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="history">Minutes History</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-2xl font-semibold">Profile</h3>
              <p className="text-sm text-muted-foreground">Manage your account details and profile information.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>First name</Label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="input-profile-first-name" />
              </div>
              <div className="space-y-2">
                <Label>Last name</Label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} data-testid="input-profile-last-name" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email address</Label>
              <p className="text-sm text-muted-foreground">
                Email cannot be updated. Please contact support if you need it changed.
              </p>
              <Input value={user?.email || ""} disabled />
            </div>
            <Button onClick={() => updateProfileMutation.mutate()} disabled={updateProfileMutation.isPending}>
              {updateProfileMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </TabsContent>

          <TabsContent value="minutes" className="space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
              <Card className="p-6">
                <h3 className="font-semibold mb-4">Your Balance</h3>
                <div className="rounded-2xl bg-muted/30 border p-8 text-center mb-6">
                  <p className="text-5xl font-bold text-primary">{remainingMinutes}</p>
                  <p className="text-sm text-muted-foreground mt-2">credits/minutes available</p>
                </div>
                <div className="space-y-3 text-sm">
                  <p className="text-xs font-semibold tracking-[0.18em] uppercase text-muted-foreground">Features Included</p>
                  <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="w-4 h-4" /><span>Real-time Meeting Transcription</span></div>
                  <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="w-4 h-4" /><span>Real-time AI Assistance</span></div>
                  <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="w-4 h-4" /><span>Unlimited Questions</span></div>
                  <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="w-4 h-4" /><span>Configurable Responses</span></div>
                </div>
              </Card>

              <Card className="p-6 space-y-6">
                <div>
                  <h3 className="font-semibold text-lg">Purchase More Minutes</h3>
                  <p className="text-sm text-muted-foreground mt-1">Increase minutes in 10-minute steps.</p>
                </div>

                <div className="space-y-3">
                  <Label>Select Minutes</Label>
                  <div className="flex items-center rounded-lg border overflow-hidden">
                    <Button type="button" variant="ghost" className="rounded-none px-4" onClick={() => setSelectedMinutes((value) => Math.max(10, value - 10))}>
                      <Minus className="w-4 h-4" />
                    </Button>
                    <div className="flex-1 text-center text-xl font-semibold py-3">{selectedMinutes}</div>
                    <Button type="button" variant="ghost" className="rounded-none px-4" onClick={() => setSelectedMinutes((value) => value + 10)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[10, 30, 60].map((minutes) => (
                      <Button key={minutes} type="button" variant={selectedMinutes === minutes ? "default" : "outline"} onClick={() => setSelectedMinutes(minutes)}>
                        {minutes}m
                      </Button>
                    ))}
                  </div>
                </div>

                <Card className="p-5 bg-muted/20">
                  <h4 className="font-medium mb-4">Order Summary</h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Minutes</span>
                      <span className="font-medium">{selectedMinutes} minutes</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Per 10 minutes</span>
                      <span className="font-medium">{formatCurrency((totalCents / selectedMinutes) * 10)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-semibold text-emerald-600">{formatCurrency(totalCents)}</span>
                    </div>
                  </div>
                </Card>

                <Button onClick={handleBuyMinutes} disabled={checkoutLoading} data-testid="button-account-buy-minutes">
                  {checkoutLoading ? "Redirecting..." : `Purchase ${selectedMinutes} Minutes`}
                </Button>
                <p className="text-xs text-center text-muted-foreground">Secure payment via Stripe</p>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="transactions">
            <Card className="overflow-hidden">
              <div className="px-6 py-5 border-b">
                <h3 className="font-semibold text-lg">Transactions</h3>
              </div>
              <div className="grid grid-cols-[60px_1.2fr_120px_120px_120px] gap-4 px-6 py-4 border-b text-sm font-medium text-muted-foreground">
                <div>No</div>
                <div>Date</div>
                <div>Type</div>
                <div>Amount</div>
                <div>Status</div>
              </div>
              {purchaseLogs.length ? purchaseLogs.map((log, index) => (
                <div key={log.id} className="grid grid-cols-[60px_1.2fr_120px_120px_120px] gap-4 px-6 py-4 border-b last:border-b-0 text-sm">
                  <div>{index + 1}</div>
                  <div>{formatDateTime(log.createdAt)}</div>
                  <div>{formatLogType(log.type)}</div>
                  <div>{formatCurrency(resolveMinutePrice(log.amount || 0))}</div>
                  <div><Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Completed</Badge></div>
                </div>
              )) : (
                <div className="p-10 text-center text-sm text-muted-foreground">No transactions yet.</div>
              )}
              <div className="px-6 py-4 text-sm text-muted-foreground">{rangeLabel(purchaseLogs.length, "transactions")}</div>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card className="overflow-hidden">
              <div className="px-6 py-5 border-b">
                <h3 className="font-semibold text-lg">Minutes History</h3>
              </div>
              <div className="grid grid-cols-[60px_1.2fr_140px_100px_1fr] gap-4 px-6 py-4 border-b text-sm font-medium text-muted-foreground">
                <div>No</div>
                <div>Date</div>
                <div>Type</div>
                <div>Minutes</div>
                <div>Reason</div>
              </div>
              {creditLogs.length ? creditLogs.map((log, index) => (
                <div key={log.id} className="grid grid-cols-[60px_1.2fr_140px_100px_1fr] gap-4 px-6 py-4 border-b last:border-b-0 text-sm">
                  <div>{index + 1}</div>
                  <div>{formatDateTime(log.createdAt)}</div>
                  <div>{formatLogType(log.type)}</div>
                  <div>{log.amount}</div>
                  <div className="text-muted-foreground break-words">{log.reason || "-"}</div>
                </div>
              )) : (
                <div className="p-10 text-center text-sm text-muted-foreground">No credit history yet.</div>
              )}
              <div className="px-6 py-4 text-sm text-muted-foreground">{rangeLabel(creditLogs.length, "history records")}</div>
            </Card>
          </TabsContent>

          <TabsContent value="security" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg">Change your password</h3>
                  <p className="text-sm text-muted-foreground mt-1">We will email you a confirmation after changing your password.</p>
                </div>
                <div className="space-y-2">
                  <Label>Current password</Label>
                  <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>New password</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Confirm new password</Label>
                  <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
                <Button onClick={() => changePasswordMutation.mutate()} disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || !confirmPassword}>
                  {changePasswordMutation.isPending ? "Updating..." : "Update password"}
                </Button>
              </div>
              <Card className="p-5 bg-muted/20 h-fit">
                <h4 className="font-medium mb-3">Password requirements</h4>
                <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                  <li>Minimum 8 characters</li>
                  <li>At least one special character</li>
                  <li>At least one number</li>
                  <li>Cannot be the same as a previous password</li>
                </ul>
                <div className="pt-4 mt-4 border-t">
                  <Button variant="outline" className="w-full" onClick={() => void onLogout()}>
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </Button>
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AccountMenu({
  user,
  onLogout,
}: {
  user?: AccountUser;
  onLogout: () => Promise<void>;
}) {
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <>
      <AccountCenterDialog user={user} open={accountOpen} onOpenChange={setAccountOpen} onLogout={onLogout} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2" data-testid="button-account-menu">
            <UserRound className="w-4 h-4" />
            <span className="hidden sm:inline">{[user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.username || "Account"}</span>
            <ChevronDown className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            <div className="space-y-0.5">
              <p className="font-medium">{[user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.username || "Account"}</p>
              <p className="text-xs text-muted-foreground break-all">{user?.email || "No email"}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAccountOpen(true)} data-testid="menu-account-details">
            <UserRound className="w-4 h-4 mr-2" />
            Account
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void onLogout()} data-testid="menu-sign-out">
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function DashboardHeader() {
  const [, navigate] = useLocation();

  const { data: user } = useQuery<{
    id: string;
    username: string;
    role: string;
    email?: string;
    firstName?: string | null;
    lastName?: string | null;
    plan?: string | null;
    minutesUsed?: number;
    minutesPurchased?: number;
    referralCredits?: number;
  }>({
    queryKey: ["/api/auth/me"],
  });

  const handleLogout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    navigate("/");
  };

  return (
    <header className="border-b bg-background/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 h-14">
        <Link href="/dashboard">
          <a className="flex items-center gap-2" data-testid="link-logo-home">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold">Zoom Mate</span>
          </a>
        </Link>
        <div className="flex items-center gap-2">
          {user?.role === "admin" && (
            <Link href="/admin">
              <Button variant="ghost" size="sm" data-testid="button-admin">
                <Shield className="w-4 h-4 mr-1" />
                Admin
              </Button>
            </Link>
          )}
          <ThemeToggle />
          <AccountMenu user={user} onLogout={handleLogout} />
        </div>
      </div>
    </header>
  );
}

const meetingTypes = [
  { value: "interview", label: "Job Meeting", icon: GraduationCap, desc: "General meeting preparation" },
  { value: "behavioral", label: "Behavioral", icon: Users, desc: "Behavioral & situational questions" },
  { value: "technical", label: "Technical", icon: Code, desc: "Technical & coding interviews" },
  { value: "sales", label: "Sales Call", icon: Briefcase, desc: "Client demos and sales presentations" },
  { value: "meeting", label: "Team Meeting", icon: MessageSquare, desc: "Standups, reviews, and discussions" },
  { value: "custom", label: "Custom", icon: Settings, desc: "Create your own assistant" },
];

function formatPromptPreview(text?: string | null) {
  const normalized = (text || "").trim().replace(/\r/g, "");
  if (!normalized) return "No system prompt saved";

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);

  return lines.join("\n");
}

function AssistantEditorDialog({
  assistant,
  trigger,
}: {
  assistant?: Assistant;
  trigger: React.ReactNode;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(assistant?.name || "");
  const [copilotType, setCopilotType] = useState(assistant?.copilotType || "custom");
  const [model, setModel] = useState(assistant?.model || "automatic");
  const [instructions, setInstructions] = useState(assistant?.customInstructions || "");
  const [responseFormat, setResponseFormat] = useState(assistant?.responseFormat || "concise");
  const [quickInterviewMode, setQuickInterviewMode] = useState(Boolean((assistant?.interviewStyle as any)?.quickInterview));
  const [targetRole, setTargetRole] = useState(String((assistant?.interviewStyle as any)?.targetRole || ""));
  const [experienceYears, setExperienceYears] = useState(
    (assistant?.interviewStyle as any)?.experienceYears != null
      ? String((assistant?.interviewStyle as any)?.experienceYears)
      : "5",
  );

  const buildAssistantPayload = () => ({
    name,
    copilotType,
    model,
    customInstructions: instructions || undefined,
    responseFormat,
    sessionMode: "interview",
    interviewStyle: quickInterviewMode
      ? {
          quickInterview: true,
          targetRole: targetRole.trim(),
          experienceYears: Number(experienceYears),
        }
      : undefined,
  });

  const { data: availableModels } = useQuery<{ openai: string[]; gemini: string[] }>({
    queryKey: ["/api/models"],
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildAssistantPayload();

      if (assistant?.id) {
        const res = await apiRequest("PATCH", `/api/assistants/${assistant.id}`, payload);
        return res.json();
      }

      const res = await apiRequest("POST", "/api/assistants", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assistants"] });
      setOpen(false);
      toast({ title: assistant ? "Assistant updated" : "Assistant created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save assistant", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!assistant?.id) return;
      await apiRequest("DELETE", `/api/assistants/${assistant.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assistants"] });
      setOpen(false);
      toast({ title: "Assistant deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete assistant", description: error.message, variant: "destructive" });
    },
  });

  const launchMutation = useMutation({
    mutationFn: async () => {
      const meetingPayload = {
        title: name,
        type: copilotType,
        responseFormat,
        model,
        customInstructions: instructions || undefined,
        sessionMode: "interview",
        interviewStyle: quickInterviewMode
          ? {
              quickInterview: true,
              targetRole: targetRole.trim(),
              experienceYears: Number(experienceYears),
            }
          : undefined,
      };

      if (assistant?.id) {
        try {
          await apiRequest("PATCH", `/api/assistants/${assistant.id}`, buildAssistantPayload());
        } catch {
          // Launch should still work even if assistant persistence is unavailable.
        }
      } else {
        try {
          await apiRequest("POST", "/api/assistants", buildAssistantPayload());
        } catch {
          // Launch should still work even if assistant persistence is unavailable.
        }
      }

      const res = await apiRequest("POST", "/api/meetings", meetingPayload);
      return res.json();
    },
    onSuccess: (meeting: Meeting) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assistants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      setOpen(false);
      navigate(`/meeting/${meeting.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to launch session", description: error.message, variant: "destructive" });
    },
  });

  const isBusy = saveMutation.isPending || deleteMutation.isPending || launchMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{assistant ? assistant.name : "New assistant"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Basics</Label>
            <div className="space-y-3 rounded-md border p-4 bg-muted/10">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-assistant-name" />
                <p className="text-xs text-muted-foreground">
                  Give your meeting assistant a descriptive name to easily identify it for future meetings.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Co-pilot</Label>
                <Select value={copilotType} onValueChange={setCopilotType}>
                  <SelectTrigger data-testid="select-assistant-copilot">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {meetingTypes.map((mt) => (
                      <SelectItem key={mt.value} value={mt.value}>{mt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose a pre-built co-pilot for common meeting types, or Custom to start from scratch.
                </p>
              </div>

            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Configuration</Label>
            <div className="space-y-3 rounded-md border p-4 bg-muted/10">
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger data-testid="select-assistant-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Auto (Recommended)</SelectItem>
                    {availableModels?.openai?.map((m) => (
                      <SelectItem key={m} value={m}>{m} (OpenAI)</SelectItem>
                    ))}
                    {availableModels?.gemini?.map((m) => (
                      <SelectItem key={m} value={m}>{m} (Gemini)</SelectItem>
                    ))}
                    {!availableModels && <SelectItem value="gpt-4o-mini">gpt-4o-mini (OpenAI)</SelectItem>}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  AI model that will power your meeting assistant&apos;s real-time responses.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Interview Mode</Label>
                <Select value={quickInterviewMode ? "quick" : "standard"} onValueChange={(v) => setQuickInterviewMode(v === "quick")}>
                  <SelectTrigger data-testid="select-assistant-interview-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quick">Quick Meeting (Recommended)</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  In Quick Meeting mode, Target Role and Experience are required.
                </p>
              </div>

              {quickInterviewMode && (
                <div className="space-y-3 rounded-md border p-3 bg-background/40">
                  <div className="space-y-1.5">
                    <Label>Target Role *</Label>
                    <Input
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                      placeholder="e.g. Senior Backend Engineer"
                      data-testid="input-assistant-target-role"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Experience (Years) *</Label>
                    <Input
                      value={experienceYears}
                      onChange={(e) => setExperienceYears(e.target.value)}
                      placeholder="5"
                      inputMode="numeric"
                      data-testid="input-assistant-experience-years"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Response Format</Label>
                <Select value={responseFormat} onValueChange={setResponseFormat}>
                  <SelectTrigger data-testid="select-assistant-response-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Automatic</SelectItem>
                    <SelectItem value="concise">Concise</SelectItem>
                    <SelectItem value="detailed">Detailed</SelectItem>
                    <SelectItem value="star">STAR</SelectItem>
                    <SelectItem value="bullet">Bullet</SelectItem>
                    <SelectItem value="technical">Technical</SelectItem>
                    <SelectItem value="short">Short</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>System Prompt</Label>
                <Textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="resize-y min-h-[220px]"
                  rows={10}
                  data-testid="input-assistant-system-prompt"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {assistant && (
              <Button
                variant="outline"
                onClick={() => deleteMutation.mutate()}
                disabled={isBusy}
                data-testid={`button-delete-assistant-${assistant.id}`}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => saveMutation.mutate()} disabled={isBusy || !name.trim()} data-testid="button-save-assistant">
                {saveMutation.isPending ? "Saving..." : "Update"}
              </Button>
              <Button
                onClick={() => launchMutation.mutate()}
                disabled={isBusy || !name.trim() || (quickInterviewMode && (!targetRole.trim() || !Number.isFinite(Number(experienceYears))))}
                data-testid="button-launch-assistant"
              >
                <Play className="w-4 h-4 mr-2" />
                {launchMutation.isPending ? "Launching..." : assistant ? "Update & Launch" : "Launch Session"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewMeetingDialog({ hasCredits, onNeedCredits }: { hasCredits?: boolean; onNeedCredits?: () => void }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("interview");
  const [format, setFormat] = useState("concise");
  const [model, setModel] = useState("automatic");
  const [instructions, setInstructions] = useState("");
  const [quickInterviewMode, setQuickInterviewMode] = useState(true);
  const [targetRole, setTargetRole] = useState("");
  const [experienceYears, setExperienceYears] = useState("5");

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);

  const { data: availableModels } = useQuery<{ openai: string[]; gemini: string[] }>({
    queryKey: ["/api/models"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/meetings", data);
      return res.json();
    },
    onSuccess: (meeting: Meeting) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      setOpen(false);
      navigate(`/meeting/${meeting.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create session", description: error.message, variant: "destructive" });
    },
  });

  const handleCreate = (free?: boolean) => {
    if (!free && hasCredits === false) {
      setOpen(false);
      onNeedCredits?.();
      return;
    }
    if (!title.trim()) {
      toast({ title: "Please enter a session title", variant: "destructive" });
      return;
    }
    if (quickInterviewMode) {
      if (!targetRole.trim()) {
        toast({ title: "Target Role is required in Quick Interview mode", variant: "destructive" });
        return;
      }
      const years = Number(experienceYears);
      if (!Number.isFinite(years) || years < 0 || years > 60) {
        toast({ title: "Experience (Years) must be a valid number", variant: "destructive" });
        return;
      }
    }
    createMutation.mutate({
      title,
      type,
      responseFormat: format,
      model,
      customInstructions: instructions || undefined,
      documentIds: selectedDocs,
      sessionMode: "interview",
      interviewStyle: quickInterviewMode
        ? {
            quickInterview: true,
            targetRole: targetRole.trim(),
            experienceYears: Number(experienceYears),
          }
        : undefined,
    });
  };

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-new-meeting">
          <Plus className="w-4 h-4 mr-2" />
          New Session
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Start a New Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Basics</Label>
            <div className="space-y-2 rounded-md border p-3 bg-muted/10">
              <Label>Name *</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Azure"
                data-testid="input-meeting-title"
              />
              <p className="text-xs text-muted-foreground">
                Give your meeting assistant a descriptive name to identify it later.
              </p>

              <Label>Co-pilot</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="select-copilot-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {meetingTypes.map((mt) => (
                    <SelectItem key={mt.value} value={mt.value}>{mt.label}</SelectItem>
                  ))}
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose a pre-built co-pilot for common meeting types, or Custom to start from scratch.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Configuration</Label>
            <div className="space-y-3 rounded-md border p-3 bg-muted/10">
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger data-testid="select-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Auto (Recommended)</SelectItem>
                    {availableModels?.openai?.map((m) => (
                      <SelectItem key={m} value={m}>{m} (OpenAI)</SelectItem>
                    ))}
                    {availableModels?.gemini?.map((m) => (
                      <SelectItem key={m} value={m}>{m} (Gemini)</SelectItem>
                    ))}
                    {!availableModels && <SelectItem value="gpt-4o-mini">gpt-4o-mini (OpenAI)</SelectItem>}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  AI model that will power your meeting assistant's real-time responses.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Interview Mode</Label>
                <Select value={quickInterviewMode ? "quick" : "standard"} onValueChange={(v) => setQuickInterviewMode(v === "quick")}>
                  <SelectTrigger data-testid="select-interview-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quick">Quick Meeting (Recommended)</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  In Quick Meeting mode, Target Role and Experience are required.
                </p>
              </div>

              {quickInterviewMode && (
                <div className="space-y-3 rounded-md border p-3 bg-background/40">
                  <div className="space-y-1.5">
                    <Label>Target Role *</Label>
                    <Input
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                      placeholder="e.g. Senior Backend Engineer"
                      data-testid="input-target-role"
                    />
                    <p className="text-xs text-muted-foreground">
                      Specify the role you're preparing for.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Experience (Years) *</Label>
                    <Input
                      value={experienceYears}
                      onChange={(e) => setExperienceYears(e.target.value)}
                      placeholder="5"
                      inputMode="numeric"
                      data-testid="input-experience-years"
                    />
                    <p className="text-xs text-muted-foreground">
                      Specify total years of relevant experience.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>System Prompt</Label>
                <Textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Paste everything in one box. For best extraction, include sections like: Job Description: ... and Resume: ..."
                  className="resize-y min-h-[220px]"
                  rows={10}
                  data-testid="input-system-context"
                />
                <p className="text-xs text-muted-foreground">
                  One box only. The assistant prioritizes Job Description + Resume context from this text.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Additional Config</Label>
            <div className="space-y-3 rounded-md border p-3 bg-muted/10">
              {documents.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Materials</Label>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        onClick={() => toggleDoc(doc.id)}
                        className={`flex items-center gap-2 p-2 rounded-md cursor-pointer border text-sm transition-colors ${
                          selectedDocs.includes(doc.id)
                            ? "border-primary bg-primary/5"
                            : "border-transparent hover-elevate"
                        }`}
                        data-testid={`button-doc-${doc.id}`}
                      >
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{doc.name}</span>
                        <Badge variant="secondary" className="ml-auto text-xs shrink-0">{doc.type}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => handleCreate(false)} disabled={createMutation.isPending} data-testid="button-create-meeting">
              {createMutation.isPending ? "Creating..." : "Start Session"}
              <Play className="w-4 h-4 ml-2" />
            </Button>
            <Button variant="outline" className="text-amber-600 border-amber-500/40 hover:bg-amber-500/10" onClick={() => handleCreate(true)} disabled={createMutation.isPending}>
              Free Session
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UploadDocumentDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [docType, setDocType] = useState("general");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const textUploadMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/documents", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      resetAndClose();
      toast({ title: "Document uploaded successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to upload document", description: error.message, variant: "destructive" });
    },
  });

  const resetAndClose = () => {
    setOpen(false);
    setName("");
    setContent("");
    setDocType("general");
    setSelectedFile(null);
  };

  const handleUpload = async () => {
    if (selectedFile) {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("name", name || selectedFile.name.replace(/\.[^.]+$/, ""));
        formData.append("type", docType);

        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        if (!res.ok) {
          let message = "Upload failed";
          try {
            const err = await res.json();
            message = err.message || err.error || message;
          } catch {
            try {
              const text = await res.text();
              if (text) {
                // Nginx/Express error pages come back as HTML; keep the message human-readable.
                message = text.startsWith("<") ? "Server upload error. Please try again." : text;
              }
            } catch {}
          }
          throw new Error(message);
        }

        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
        resetAndClose();
        toast({ title: "Document uploaded successfully" });
      } catch (error: any) {
        toast({ title: "Failed to upload document", description: error.message, variant: "destructive" });
      } finally {
        setIsUploading(false);
      }
      return;
    }

    if (!name.trim() || !content.trim()) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }
    textUploadMutation.mutate({ name, content, type: docType });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
        toast({ title: "File too large", description: "Maximum file size is 20MB", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    setName(file.name.replace(/\.[^.]+$/, ""));
    setContent("");

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "txt" || ext === "md") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setContent(ev.target?.result as string || "");
      };
      reader.readAsText(file);
    }
  };

  const isBinaryFile = selectedFile && !["txt", "md"].includes(selectedFile.name.split(".").pop()?.toLowerCase() || "");
  const isPending = isUploading || textUploadMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-upload-doc">
          <Upload className="w-4 h-4 mr-2" />
          Upload Document
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div
            className="border-2 border-dashed rounded-md p-8 text-center cursor-pointer hover-elevate transition-colors"
            onClick={() => document.getElementById("file-upload")?.click()}
            data-testid="dropzone-file"
          >
            {selectedFile ? (
              <>
                <FileText className="w-8 h-8 mx-auto text-primary mb-2" />
                <p className="text-sm font-medium">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{(selectedFile.size / 1024).toFixed(0)} KB - Click to change</p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Click to upload or drag and drop</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, TXT, MD (max 20MB)</p>
              </>
            )}
            <input
              id="file-upload"
              type="file"
              accept=".txt,.md,.pdf,.doc,.docx"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          <div className="space-y-2">
            <Label>Document Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Resume"
              data-testid="input-doc-name"
            />
          </div>

          <div className="space-y-2">
            <Label>Document Type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger data-testid="select-doc-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="resume">Resume / CV</SelectItem>
                <SelectItem value="job_description">Job Description</SelectItem>
                <SelectItem value="notes">Meeting Notes</SelectItem>
                <SelectItem value="product">Product Specs</SelectItem>
                <SelectItem value="general">General Document</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!isBinaryFile && (
            <div className="space-y-2">
              <Label>Content {selectedFile ? "(preview)" : ""}</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste your document content here, or upload a file above..."
                className="resize-none"
                rows={6}
                data-testid="input-doc-content"
              />
            </div>
          )}

          {isBinaryFile && (
            <p className="text-xs text-muted-foreground text-center">
              Text will be automatically extracted from the file on upload.
            </p>
          )}

          <Button className="w-full" onClick={handleUpload} disabled={isPending || (!selectedFile && (!name.trim() || !content.trim()))} data-testid="button-submit-doc">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              "Upload Document"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MeetingsTab() {
  const { data: meetings = [], isLoading } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/meetings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
    },
  });

  const sortedMeetings = [...meetings].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-4 animate-pulse">
            <div className="h-4 bg-muted rounded w-1/3 mb-2" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {meetings.length === 0 && (
        <Card className="p-12 text-center">
          <Mic className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="font-semibold mb-1">No sessions yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Start your first AI-assisted meeting session</p>
          <NewMeetingDialog />
        </Card>
      )}

      {meetings.length > 0 && (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[70px_1.4fr_1fr_140px_120px] gap-4 px-8 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b">
            <div>No</div>
            <div>Assistant</div>
            <div>Start Time</div>
            <div>Duration</div>
            <div>Actions</div>
          </div>

          {sortedMeetings.slice(0, 10).map((meeting, index) => (
            <div
              key={meeting.id}
              className="grid grid-cols-[70px_1.4fr_1fr_140px_120px] gap-4 px-8 py-4 border-b last:border-b-0 items-center"
              data-testid={`row-meeting-${meeting.id}`}
            >
              <div className="text-muted-foreground">{index + 1}</div>
              <div className="min-w-0">
                <Link href={`/session/${meeting.id}`}>
                  <a className="font-semibold text-primary hover:underline truncate block" data-testid={`link-meeting-${meeting.id}`}>
                    {meeting.title}
                  </a>
                </Link>
              </div>
              <div className="text-sm">
                {meeting.createdAt ? new Date(meeting.createdAt).toLocaleString() : "-"}
              </div>
              <div>
                <Badge variant="secondary">
                  <Clock className="w-3 h-3 mr-1" />
                  {meeting.totalMinutes} mins
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/session/${meeting.id}`}>
                  <Button variant="outline" size="sm" data-testid={`button-view-${meeting.id}`}>
                    View
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMutation.mutate(meeting.id)}
                  data-testid={`button-delete-${meeting.id}`}
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}

          <div className="px-8 py-4 text-sm text-muted-foreground">
            Showing 1-{Math.min(sortedMeetings.length, 10)} of {sortedMeetings.length} sessions
          </div>
        </Card>
      )}
    </div>
  );
}

function DocumentsTab() {
  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <Card key={i} className="p-4 animate-pulse">
            <div className="h-4 bg-muted rounded w-1/3 mb-2" />
            <div className="h-3 bg-muted rounded w-2/3" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {documents.length > 0 ? (
        <div className="space-y-2">
          {documents.map((doc) => (
            <Card key={doc.id} className="p-4" data-testid={`card-doc-${doc.id}`}>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-5 h-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.type} | {doc.content.length} chars |{" "}
                      {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : ""}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMutation.mutate(doc.id)}
                  data-testid={`button-delete-doc-${doc.id}`}
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="font-semibold mb-1">No documents yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Upload your resume, job descriptions, or notes for the AI to personalize responses</p>
          <UploadDocumentDialog />
        </Card>
      )}
    </div>
  );
}

function BillingTab() {
  const { toast } = useToast();
  const [portalLoading, setPortalLoading] = useState(false);

  const { data: user } = useQuery<{ id: string; plan: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["/api/stripe/products"],
  });

  const { data: subscriptionData } = useQuery<{ subscription: any; plan: string }>({
    queryKey: ["/api/stripe/subscription"],
  });

  const handleSubscribe = async (priceId: string) => {
    try {
      const res = await apiRequest("POST", "/api/stripe/checkout", { priceId });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      toast({ title: "Failed to start checkout", description: error.message, variant: "destructive" });
    }
  };

  const handleManageBilling = async () => {
    setPortalLoading(true);
    try {
      const res = await apiRequest("POST", "/api/stripe/portal");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      toast({ title: "Failed to open billing portal", description: error.message, variant: "destructive" });
    } finally {
      setPortalLoading(false);
    }
  };

  const currentPlan = subscriptionData?.plan || user?.plan || "free";
  const hasSubscription = !!subscriptionData?.subscription;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              Current Plan
            </h3>
            <p className="text-sm text-muted-foreground mt-1">Manage your subscription and billing</p>
          </div>
          <Badge variant={currentPlan === "free" ? "secondary" : "default"} className="text-sm capitalize" data-testid="badge-current-plan">
            {currentPlan}
          </Badge>
        </div>

        {hasSubscription && (
          <div className="p-4 border rounded-md mb-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-medium">Active Subscription</p>
                <p className="text-xs text-muted-foreground">
                  Status: {subscriptionData?.subscription?.status || "active"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleManageBilling}
                disabled={portalLoading}
                data-testid="button-manage-billing"
              >
                {portalLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ExternalLink className="w-4 h-4 mr-1" />}
                Manage Billing
              </Button>
            </div>
          </div>
        )}

        {!hasSubscription && currentPlan === "free" && (
          <div className="p-4 border rounded-md border-dashed mb-4">
            <p className="text-sm text-muted-foreground">You're on the free plan with 5 minutes per hour. Upgrade to unlock unlimited usage.</p>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            name: "Free",
            price: "$0",
            period: "forever",
            desc: "5 minutes per hour",
            plan: "free",
            features: ["Real-time Transcription", "AI Responses", "Screen Analyzer"],
          },
          {
            name: "Standard",
            price: "$14.99",
            period: "/month",
            desc: "Unlimited usage",
            plan: "standard",
            popular: true,
            features: ["Everything in Free", "Priority Support", "Minutes never expire"],
          },
          {
            name: "Enterprise",
            price: "$49.99",
            period: "/month",
            desc: "Team features",
            plan: "enterprise",
            features: ["Everything in Standard", "Team members", "Dedicated support"],
          },
        ].map((tier) => {
          const isCurrentPlan = currentPlan === tier.plan;
          const product = products.find((p: any) =>
            p.metadata && typeof p.metadata === 'object' && (p.metadata as any).plan === tier.plan
          );
          const priceId = product?.prices?.[0]?.id;

          return (
            <Card key={tier.plan} className={`p-5 flex flex-col ${isCurrentPlan ? "border-primary" : ""}`} data-testid={`card-billing-${tier.plan}`}>
              <div className="mb-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h4 className="font-semibold">{tier.name}</h4>
                  {isCurrentPlan && <Badge variant="secondary" className="text-xs">Current</Badge>}
                  {tier.popular && !isCurrentPlan && <Badge className="text-xs">Popular</Badge>}
                </div>
                <div className="flex items-baseline gap-1 mt-2 flex-wrap">
                  <span className="text-2xl font-bold">{tier.price}</span>
                  {tier.period !== "forever" && <span className="text-sm text-muted-foreground">{tier.period}</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{tier.desc}</p>
              </div>
              <ul className="space-y-2 flex-1 mb-4">
                {tier.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Zap className="w-3 h-3 text-primary shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {isCurrentPlan ? (
                hasSubscription ? (
                  <Button variant="outline" size="sm" onClick={handleManageBilling} disabled={portalLoading} data-testid={`button-manage-${tier.plan}`}>
                    Manage
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled data-testid={`button-current-${tier.plan}`}>
                    Current Plan
                  </Button>
                )
              ) : tier.plan === "free" ? (
                <Button variant="outline" size="sm" disabled data-testid={`button-free-${tier.plan}`}>
                  Free Tier
                </Button>
              ) : priceId ? (
                <Button size="sm" onClick={() => handleSubscribe(priceId)} data-testid={`button-upgrade-${tier.plan}`}>
                  Upgrade
                </Button>
              ) : (
                <Button size="sm" disabled data-testid={`button-loading-${tier.plan}`}>
                  Loading...
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function MinutesTab() {
  const { toast } = useToast();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selectedMinutes, setSelectedMinutes] = useState(10);

  const { data: user } = useQuery<{
    id: string;
    minutesUsed: number;
    minutesPurchased: number;
    referralCredits: number;
  }>({
    queryKey: ["/api/auth/me"],
  });

  const remainingMinutes = Math.max(
    0,
    (user?.minutesPurchased || 0) + (user?.referralCredits || 0) - (user?.minutesUsed || 0),
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("minutes_purchase");
    const sessionId = params.get("session_id");
    const tab = params.get("tab");

    if (tab !== "minutes") return;

    if (status === "cancelled") {
      toast({ title: "Purchase cancelled" });
      window.history.replaceState({}, "", "/dashboard?tab=minutes");
      return;
    }

    if (status !== "success" || !sessionId) return;
    if (confirming) return;

    setConfirming(true);
    apiRequest("POST", "/api/stripe/minutes-confirm", { sessionId })
      .then((res) => res.json())
      .then((data) => {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        toast({
          title: "Minutes added",
          description: `${data.minutesAdded} minutes were added to your balance.`,
        });
        window.history.replaceState({}, "", "/dashboard?tab=minutes");
      })
      .catch((error: any) => {
        toast({
          title: "Failed to confirm purchase",
          description: error.message,
          variant: "destructive",
        });
      })
      .finally(() => {
        setConfirming(false);
      });
  }, [confirming, toast]);

  const pricingLookup: Record<number, number> = {
    10: 249,
    30: 599,
    60: 1199,
  };

  const totalCents = (() => {
    let remaining = selectedMinutes;
    let total = 0;
    while (remaining >= 60) {
      total += pricingLookup[60];
      remaining -= 60;
    }
    while (remaining >= 30) {
      total += pricingLookup[30];
      remaining -= 30;
    }
    while (remaining >= 10) {
      total += pricingLookup[10];
      remaining -= 10;
    }
    return total;
  })();

  const perTenCents = selectedMinutes > 0 ? Math.round(totalCents / (selectedMinutes / 10)) : 0;

  const handleBuyMinutes = async () => {
    setCheckoutLoading(true);
    try {
      const res = await apiRequest("POST", "/api/stripe/minutes-checkout", { minutes: selectedMinutes });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      toast({ title: "Failed to start checkout", description: error.message, variant: "destructive" });
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Minutes Balance
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Buy extra minutes anytime. Purchased minutes update after successful checkout.
            </p>
          </div>
          <Badge variant="default" className="text-sm" data-testid="badge-minutes-remaining">
            {remainingMinutes} min available
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <div className="rounded-md border p-4 bg-muted/10">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Purchased</p>
            <p className="text-2xl font-bold mt-1">{user?.minutesPurchased || 0}</p>
          </div>
          <div className="rounded-md border p-4 bg-muted/10">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Used</p>
            <p className="text-2xl font-bold mt-1">{user?.minutesUsed || 0}</p>
          </div>
          <div className="rounded-md border p-4 bg-muted/10">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Referral Credits</p>
            <p className="text-2xl font-bold mt-1">{user?.referralCredits || 0}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-xl font-semibold">Purchase More Credits</h3>
        </div>

        <div className="space-y-3">
          <Label>Select Minutes</Label>
          <div className="flex items-center rounded-md border overflow-hidden max-w-xl">
            <Button
              type="button"
              variant="ghost"
              className="rounded-none px-5"
              onClick={() => setSelectedMinutes((value) => Math.max(10, value - 10))}
              data-testid="button-minutes-minus"
            >
              <Minus className="w-4 h-4" />
            </Button>
            <div className="flex-1 text-center text-2xl font-semibold py-3 border-x">
              {selectedMinutes}
            </div>
            <Button
              type="button"
              variant="ghost"
              className="rounded-none px-5"
              onClick={() => setSelectedMinutes((value) => value + 10)}
              data-testid="button-minutes-plus"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex gap-3 flex-wrap">
            {[10, 30, 60].map((minutes) => (
              <Button
                key={minutes}
                type="button"
                variant={selectedMinutes === minutes ? "default" : "outline"}
                onClick={() => setSelectedMinutes(minutes)}
                data-testid={`button-minutes-preset-${minutes}`}
              >
                {minutes}m
              </Button>
            ))}
          </div>
        </div>

        <Card className="p-5 bg-muted/10">
          <div className="space-y-4">
            <h4 className="font-semibold flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              Order Summary
            </h4>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between border-b pb-3">
                <span className="text-muted-foreground">Minutes</span>
                <span>{selectedMinutes} minutes</span>
              </div>
              <div className="flex items-center justify-between border-b pb-3">
                <span className="text-muted-foreground">Per 10 minutes</span>
                <span>${(perTenCents / 100).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between font-semibold text-base">
                <span>Total</span>
                <span className="text-green-600">${(totalCents / 100).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </Card>

        <Button onClick={handleBuyMinutes} disabled={checkoutLoading} data-testid="button-buy-minutes">
          {checkoutLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Redirecting...
            </>
          ) : (
            <>Buy {selectedMinutes} minutes</>
          )}
        </Button>
      </Card>
    </div>
  );
}

function AssistantsTab() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const { data: assistants = [], isLoading } = useQuery<Assistant[]>({
    queryKey: ["/api/assistants"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/assistants/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assistants"] });
    },
  });

  const launchMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/assistants/${id}/launch`);
      return res.json();
    },
    onSuccess: (meeting: Meeting) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      navigate(`/meeting/${meeting.id}`);
    },
  });

  const filteredAssistants = assistants.filter((assistant) =>
    assistant.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-4 animate-pulse">
            <div className="h-4 bg-muted rounded w-1/3 mb-2" />
            <div className="h-3 bg-muted rounded w-2/3" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div>
          <h2 className="text-2xl font-bold">Assistants</h2>
          <p className="text-sm text-muted-foreground">Manage and create assistants <Badge variant="secondary" className="ml-2">{assistants.length} total</Badge></p>
        </div>
        <AssistantEditorDialog
          trigger={(
            <Button data-testid="button-new-assistant">
              <Plus className="w-4 h-4 mr-2" />
              New assistant
            </Button>
          )}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assistants..."
              className="pl-9"
              data-testid="input-search-assistants"
            />
          </div>
          <Button variant="outline" data-testid="button-assistant-filters">
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </Button>
        </div>

        <div className="grid grid-cols-[80px_260px_1fr_auto] gap-4 px-8 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b">
          <div>No</div>
          <div>Name</div>
          <div>System Prompt</div>
          <div>Actions</div>
        </div>

        {filteredAssistants.length > 0 ? (
          filteredAssistants.map((assistant, index) => (
            <div
              key={assistant.id}
              className="grid grid-cols-[80px_260px_1fr_auto] gap-4 px-8 py-4 border-b last:border-b-0 items-start"
            >
              <div className="text-muted-foreground">{index + 1}</div>
              <div className="min-w-0">
                <AssistantEditorDialog
                  assistant={assistant}
                  trigger={(
                    <button
                      type="button"
                      className="text-left w-full"
                      data-testid={`link-assistant-${assistant.id}`}
                    >
                      <div className="font-semibold text-primary hover:underline cursor-pointer truncate">
                        {assistant.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5">
                          {meetingTypes.find((mt) => mt.value === assistant.copilotType)?.label || "Custom"}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5">
                          {assistant.model === "automatic" ? "Auto" : assistant.model}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5">
                          {assistant.responseFormat || "concise"}
                        </span>
                      </div>
                    </button>
                  )}
                />
              </div>
              <div className="min-w-0">
                <AssistantEditorDialog
                  assistant={assistant}
                  trigger={(
                    <button
                      type="button"
                      className="text-left w-full"
                      data-testid={`button-assistant-prompt-preview-${assistant.id}`}
                    >
                      <div className="rounded-md border bg-muted/20 px-3 py-2">
                        <p className="text-sm text-foreground whitespace-pre-line break-words line-clamp-3">
                          {formatPromptPreview(assistant.customInstructions)}
                        </p>
                      </div>
                    </button>
                  )}
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <AssistantEditorDialog
                  assistant={assistant}
                  trigger={(
                    <Button variant="outline" size="sm" data-testid={`button-edit-assistant-${assistant.id}`}>
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                  )}
                />
                <Button
                  size="sm"
                  onClick={() => launchMutation.mutate(assistant.id)}
                  disabled={launchMutation.isPending}
                  data-testid={`button-launch-assistant-row-${assistant.id}`}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Launch Session
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMutation.mutate(assistant.id)}
                  data-testid={`button-delete-assistant-row-${assistant.id}`}
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No assistants found.
          </div>
        )}

        <div className="px-8 py-4 text-sm text-muted-foreground">
          Showing {filteredAssistants.length === 0 ? 0 : 1}-{filteredAssistants.length} of {assistants.length} assistants
        </div>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  const initialTab = (() => {
    if (typeof window === "undefined") return "assistants";
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested && ["assistants", "documents", "sessions", "minutes", "billing", "desktop"].includes(requested)) {
      return requested;
    }
    return "assistants";
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const { data: meetings = [] } = useQuery<Meeting[]>({ queryKey: ["/api/meetings"] });
  const { data: documents = [] } = useQuery<Document[]>({ queryKey: ["/api/documents"] });
  const { data: assistants = [] } = useQuery<Assistant[]>({ queryKey: ["/api/assistants"] });
  const { data: me } = useQuery<{ minutesPurchased: number; minutesUsed: number; referralCredits: number; plan: string; role: string }>({
    queryKey: ["/api/auth/me"],
  });

  const hasCredits = !!(
    (me?.plan && me.plan !== "free") ||
    ((me?.minutesPurchased ?? 0) > (me?.minutesUsed ?? 0)) ||
    ((me?.referralCredits ?? 0) > 0) ||
    me?.role === "admin"
  );

  const [, navigate] = useLocation();
  const { toast } = useToast();

  const launchSession = (payload: { title: string; sessionMode: string; isPractice?: boolean }) =>
    apiRequest("POST", "/api/meetings", {
      title: payload.title,
      type: "interview",
      sessionMode: payload.sessionMode,
      isPractice: payload.isPractice || false,
      responseFormat: "concise",
      model: "automatic",
    }).then((r) => r.json());

  const quickLaunchMutation = useMutation({
    mutationFn: launchSession,
    onSuccess: (meeting: Meeting) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      navigate(`/meeting/${meeting.id}`);
    },
    onError: (err: Error) => toast({ title: "Failed to start session", description: err.message, variant: "destructive" }),
  });

  const freeSessionMutation = useMutation({
    mutationFn: launchSession,
    onSuccess: (meeting: Meeting) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      navigate(`/meeting/${meeting.id}`);
    },
    onError: (err: Error) => toast({ title: "Failed to start session", description: err.message, variant: "destructive" }),
  });

  const handleQuickLaunch = (payload: { title: string; sessionMode: string; isPractice?: boolean }) => {
    if (!hasCredits) {
      setActiveTab("billing");
      toast({ title: "No credits", description: "Buy minutes to start a full session." });
      return;
    }
    quickLaunchMutation.mutate(payload);
  };

  const handleFreeSession = (payload: { title: string; sessionMode: string }) => {
    freeSessionMutation.mutate({ ...payload, isPractice: true });
  };

  const sections: { value: string; label: string; icon: React.ElementType; testId: string }[] = [
    { value: "assistants", label: "Assistants", icon: FileText, testId: "tab-assistants" },
    { value: "documents", label: "Knowledge Base", icon: FolderOpen, testId: "tab-documents" },
    { value: "sessions", label: "Sessions", icon: Mic, testId: "tab-meetings" },
    { value: "minutes", label: "Minutes", icon: Clock, testId: "tab-minutes" },
    { value: "billing", label: "Billing", icon: CreditCard, testId: "tab-billing" },
    { value: "desktop", label: "Desktop App", icon: Monitor, testId: "tab-desktop" },
  ] as const;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (activeTab === "assistants") {
      params.delete("tab");
    } else {
      params.set("tab", activeTab);
    }
    const next = params.toString();
    const nextUrl = next ? `/dashboard?${next}` : "/dashboard";
    window.history.replaceState({}, "", nextUrl);
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="w-full px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1">Manage your sessions and knowledge base</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <UploadDocumentDialog />
              <NewMeetingDialog hasCredits={hasCredits} onNeedCredits={() => { setActiveTab("billing"); toast({ title: "No credits", description: "Buy minutes to start a full session." }); }} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {/* Quick Interview */}
            <Card className="p-5 hover:border-primary/50 hover:shadow-md transition-all group">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Flame className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-sm">Quick Meeting</p>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Live</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">Jump straight into a real-time meeting session with AI assistance.</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <Button size="sm" className="h-7 text-xs px-3" disabled={quickLaunchMutation.isPending || freeSessionMutation.isPending}
                      onClick={() => handleQuickLaunch({ title: "Quick Meeting", sessionMode: "interview" })}>
                      {quickLaunchMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                      Start Session
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs px-3 text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
                      disabled={quickLaunchMutation.isPending || freeSessionMutation.isPending}
                      onClick={() => handleFreeSession({ title: "Quick Meeting", sessionMode: "interview" })}>
                      {freeSessionMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                      Free Session
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            {/* Practice Mode */}
            <Card className="p-5 hover:border-amber-500/50 hover:shadow-md transition-all group">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 group-hover:bg-amber-500/20 transition-colors">
                  <Timer className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-sm">Practice Mode</p>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-600">6 min free / 30 min</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">Practice meetings for free — 6 minutes every 30 minutes, no credit needed.</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <Button size="sm" className="h-7 text-xs px-3" disabled={quickLaunchMutation.isPending || freeSessionMutation.isPending}
                      onClick={() => handleQuickLaunch({ title: "Practice Session", sessionMode: "interview", isPractice: true })}>
                      Start Session
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs px-3 text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
                      disabled={quickLaunchMutation.isPending || freeSessionMutation.isPending}
                      onClick={() => handleFreeSession({ title: "Practice Session", sessionMode: "interview" })}>
                      Free Session
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            {/* Phone Interview */}
            <Card className="p-5 hover:border-emerald-500/50 hover:shadow-md transition-all group">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/20 transition-colors">
                  <Phone className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-sm">Phone Meeting</p>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Mic only</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">Optimized for phone or audio-only meetings — mic input, no screen required.</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <Button size="sm" className="h-7 text-xs px-3" disabled={quickLaunchMutation.isPending || freeSessionMutation.isPending}
                      onClick={() => handleQuickLaunch({ title: "Phone Meeting", sessionMode: "phone" })}>
                      Start Session
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs px-3 text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
                      disabled={quickLaunchMutation.isPending || freeSessionMutation.isPending}
                      onClick={() => handleFreeSession({ title: "Phone Meeting", sessionMode: "phone" })}>
                      Free Session
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="grid w-full gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="rounded-2xl border bg-card/70 p-3 shadow-sm lg:sticky lg:top-24 lg:self-start">
              <TabsList className="grid h-auto w-full gap-1 bg-transparent p-0">
                {sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <TabsTrigger
                      key={section.value}
                      value={section.value}
                      data-testid={section.testId}
                      className="justify-start gap-3 rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {section.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </aside>
            <div className="min-w-0">
              <TabsContent value="assistants" className="mt-0">
                <AssistantsTab />
              </TabsContent>
              <TabsContent value="documents" className="mt-0">
                <DocumentsTab />
              </TabsContent>
              <TabsContent value="sessions" className="mt-0">
                <MeetingsTab />
              </TabsContent>
              <TabsContent value="minutes" className="mt-0">
                <MinutesTab />
              </TabsContent>
              <TabsContent value="billing" className="mt-0">
                <BillingTab />
              </TabsContent>
              <TabsContent value="desktop" className="mt-0">
                <DesktopAppTab />
              </TabsContent>
            </div>
          </Tabs>
        </motion.div>
      </main>
    </div>
  );
}

function DesktopAppTab() {
  const platforms = [
    {
      name: "Windows",
      icon: Monitor,
      req: "Windows 10 or later (64-bit)",
    },
    {
      name: "macOS",
      icon: null,
      req: "macOS 12.0 Monterey or later",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Desktop App</h2>
        <p className="text-sm text-muted-foreground">
          A transparent always-on-top overlay that floats above Zoom, Meet, Teams, or any meeting window — invisible to screen share.
        </p>
      </div>

      {/* Coming Soon banner */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <span className="text-xl">🚀</span>
        </div>
        <div>
          <p className="font-semibold text-sm">Coming Soon</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            The desktop app is under final testing and will be available for download shortly. Stay tuned!
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {platforms.map((p) => (
          <Card key={p.name} className="p-6 flex flex-col gap-4 opacity-60 select-none">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                {p.icon ? <p.icon className="w-6 h-6 text-primary" /> : <span className="text-2xl">🍎</span>}
              </div>
              <div>
                <p className="font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.req}</p>
              </div>
            </div>
            <Button className="w-full gap-2" disabled>
              <Download className="w-4 h-4" />
              Coming Soon
            </Button>
          </Card>
        ))}
      </div>

      <Card className="p-5 border-dashed">
        <p className="text-sm font-semibold mb-2">How it works</p>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>Install and open the app — sign in with your Zoommate account</li>
          <li>A transparent panel floats above all your windows</li>
          <li>Press <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">Enter</span> to get an AI answer for the latest question</li>
          <li>Invisible to screen share — only you can see it</li>
          <li>Drag to move, resize edges to adjust size, use the opacity slider</li>
        </ul>
      </Card>
    </div>
  );
}

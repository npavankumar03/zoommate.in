import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Users, BarChart3, MessageSquare, ArrowLeft,
  Shield, Search, Loader2, Settings, Activity, Key, Eye, EyeOff, Save,
  CreditCard, Gift, Ban, History, ChevronDown, ChevronUp, DollarSign, Plus,
  Download, Megaphone, AlertTriangle, Trash2, UserX, CheckCircle, XCircle,
  TrendingUp, UserPlus, Globe, Wrench, FileText, Database, Router, BarChart2,
  Mail
} from "lucide-react";
import { motion } from "framer-motion";

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  role: string;
  minutesUsed: number;
  minutesPurchased: number;
  referralCredits: number;
  plan: string;
  status: string;
  lastLoginAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
}

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  paidUsers: number;
  totalSessions: number;
  activeSessions: number;
  totalResponses: number;
  totalCredits: number;
  totalReferralCredits: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  revenueEstimate: number;
  maintenanceMode: boolean;
}

interface CreditLogEntry {
  id: string;
  userId: string;
  adminId: string;
  type: string;
  amount: number;
  reason: string | null;
  createdAt: string;
}

interface AnnouncementItem {
  id: string;
  title: string;
  message: string;
  type: string;
  isActive: boolean;
  createdAt: string;
}

function GrantCreditsDialog({ user, open, onOpenChange }: { user: AdminUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const grantMutation = useMutation({
    mutationFn: async (data: { amount: number; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${user.id}/grant-credits`, data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: data.message });
      setAmount("");
      setReason("");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to grant credits", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant Credits</DialogTitle>
          <DialogDescription>Add credits (minutes) to {user.username}'s account</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm font-medium mb-1.5">Current Balance</p>
            <div className="flex items-center gap-4 flex-wrap">
              <Badge variant="secondary">{user.minutesPurchased} purchased</Badge>
              <Badge variant="secondary">{user.minutesUsed} used</Badge>
              <Badge variant="secondary">{user.minutesPurchased - user.minutesUsed} remaining</Badge>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Credits to Add</p>
            <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount (minutes)" data-testid="input-grant-amount" />
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Reason (optional)</p>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g., Support ticket resolution" data-testid="input-grant-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => grantMutation.mutate({ amount: parseInt(amount), reason })} disabled={!amount || parseInt(amount) <= 0 || grantMutation.isPending} data-testid="button-confirm-grant">
            {grantMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
            Grant {amount ? `${amount} Credits` : "Credits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantReferralDialog({ user, open, onOpenChange }: { user: AdminUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const grantMutation = useMutation({
    mutationFn: async (data: { amount: number; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${user.id}/grant-referral-credits`, data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: data.message });
      setAmount("");
      setReason("");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to grant referral credits", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant Referral Credits</DialogTitle>
          <DialogDescription>Add referral bonus credits to {user.username}'s account</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm font-medium mb-1.5">Current Referral Balance</p>
            <Badge variant="secondary">{user.referralCredits || 0} referral credits</Badge>
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Referral Credits to Add</p>
            <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount" data-testid="input-referral-amount" />
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Reason (optional)</p>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g., Referred 3 new users" data-testid="input-referral-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => grantMutation.mutate({ amount: parseInt(amount), reason })} disabled={!amount || parseInt(amount) <= 0 || grantMutation.isPending} data-testid="button-confirm-referral">
            {grantMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Gift className="w-4 h-4 mr-1" />}
            Grant {amount ? `${amount} Referral Credits` : "Referral Credits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelSubscriptionDialog({ user, open, onOpenChange }: { user: AdminUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  const cancelMutation = useMutation({
    mutationFn: async (data: { reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${user.id}/cancel-subscription`, data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: data.message });
      setReason("");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to cancel subscription", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Subscription</DialogTitle>
          <DialogDescription>Cancel {user.username}'s subscription and revert to free plan</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm font-medium mb-1.5">Current Plan</p>
            <Badge variant={user.plan === "enterprise" ? "default" : "secondary"}>
              {user.plan.charAt(0).toUpperCase() + user.plan.slice(1)}
            </Badge>
          </div>
          <div className="p-3 border border-destructive/30 rounded-md bg-destructive/5">
            <p className="text-sm text-destructive font-medium">Warning</p>
            <p className="text-xs text-muted-foreground mt-1">This will cancel the Stripe subscription and revert to the free plan. This action cannot be undone.</p>
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Reason (optional)</p>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g., User requested cancellation" data-testid="input-cancel-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep Subscription</Button>
          <Button variant="destructive" onClick={() => cancelMutation.mutate({ reason })} disabled={cancelMutation.isPending} data-testid="button-confirm-cancel">
            {cancelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Ban className="w-4 h-4 mr-1" />}
            Cancel Subscription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreditHistoryDialog({ user, open, onOpenChange }: { user: AdminUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: logs = [], isLoading } = useQuery<CreditLogEntry[]>({
    queryKey: ["/api/admin/users", user.id, "credit-logs"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${user.id}/credit-logs`);
      if (!res.ok) throw new Error("Failed to fetch credit logs");
      return res.json();
    },
    enabled: open,
  });

  const typeLabels: Record<string, { label: string; color: string }> = {
    grant: { label: "Credits Granted", color: "text-chart-3" },
    referral: { label: "Referral Credits", color: "text-chart-2" },
    subscription_cancelled: { label: "Subscription Cancelled", color: "text-destructive" },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Credit History</DialogTitle>
          <DialogDescription>Credit and subscription activity for {user.username}</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No credit history found</div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-2">
                {logs.map((log) => {
                  const info = typeLabels[log.type] || { label: log.type, color: "text-foreground" };
                  return (
                    <div key={log.id} className="p-3 border rounded-md" data-testid={`row-credit-log-${log.id}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${info.color}`}>{info.label}</span>
                        {log.amount > 0 && <Badge variant="secondary">+{log.amount}</Badge>}
                      </div>
                      {log.reason && <p className="text-xs text-muted-foreground mt-1">{log.reason}</p>}
                      <p className="text-xs text-muted-foreground mt-1">{log.createdAt ? new Date(log.createdAt).toLocaleString() : "N/A"}</p>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({ user, open, onOpenChange }: { user: AdminUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [confirmText, setConfirmText] = useState("");

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/admin/users/${user.id}`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: data.message });
      setConfirmText("");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete user", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete User</DialogTitle>
          <DialogDescription>Permanently delete {user.username} and all their data</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="p-3 border border-destructive/30 rounded-md bg-destructive/5">
            <p className="text-sm text-destructive font-medium">Danger Zone</p>
            <p className="text-xs text-muted-foreground mt-1">This will permanently delete the user account, all their sessions, responses, documents, and credit logs. This action is irreversible.</p>
          </div>
          <div>
            <p className="text-sm font-medium mb-1.5">Type "{user.username}" to confirm</p>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={user.username} data-testid="input-delete-confirm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={confirmText !== user.username || deleteMutation.isPending} data-testid="button-confirm-delete">
            {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
            Delete User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserRow({ user, selected, onSelect }: { user: AdminUser; selected: boolean; onSelect: (checked: boolean) => void }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "User updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update user", description: error.message, variant: "destructive" });
    },
  });

  const remaining = (user.minutesPurchased || 0) - (user.minutesUsed || 0);
  const statusColors: Record<string, string> = {
    active: "bg-emerald-500",
    suspended: "bg-amber-500",
    banned: "bg-red-500",
  };

  return (
    <>
      <div className="border rounded-md" data-testid={`row-user-${user.id}`}>
        <div className="p-4 flex items-center justify-between gap-4 flex-wrap cursor-pointer hover-elevate" onClick={() => setExpanded(!expanded)} data-testid={`button-expand-user-${user.id}`}>
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => { e.stopPropagation(); onSelect(e.target.checked); }}
              className="w-4 h-4 rounded border-muted-foreground"
              data-testid={`checkbox-user-${user.id}`}
            />
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColors[user.status] || "bg-muted-foreground"}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-sm" data-testid={`text-username-${user.id}`}>{user.username}</p>
                <Badge variant={user.role === "admin" ? "default" : "secondary"} className="text-xs">{user.role}</Badge>
                <Badge variant="secondary" className="text-xs">{user.plan.charAt(0).toUpperCase() + user.plan.slice(1)}</Badge>
                {user.status !== "active" && (
                  <Badge variant="destructive" className="text-xs">{user.status}</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {user.email || "No email"} | Joined: {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "N/A"}
                {user.lastLoginAt && ` | Last login: ${new Date(user.lastLoginAt).toLocaleDateString()}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Credits</p>
              <p className="text-sm font-medium" data-testid={`text-credits-${user.id}`}>{remaining} remaining</p>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>

        {expanded && (
          <div className="border-t px-4 py-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-3 bg-muted/50 rounded-md">
                <p className="text-xs text-muted-foreground">Purchased</p>
                <p className="text-lg font-semibold">{user.minutesPurchased || 0}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-md">
                <p className="text-xs text-muted-foreground">Used</p>
                <p className="text-lg font-semibold">{user.minutesUsed || 0}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-md">
                <p className="text-xs text-muted-foreground">Remaining</p>
                <p className="text-lg font-semibold">{remaining}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-md">
                <p className="text-xs text-muted-foreground">Referral</p>
                <p className="text-lg font-semibold">{user.referralCredits || 0}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-md">
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="text-lg font-semibold capitalize">{user.status}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Role</p>
                <Select value={user.role} onValueChange={(role) => updateUserMutation.mutate({ id: user.id, data: { role } })}>
                  <SelectTrigger className="w-[120px]" data-testid={`select-role-${user.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Plan</p>
                <Select value={user.plan} onValueChange={(plan) => updateUserMutation.mutate({ id: user.id, data: { plan } })}>
                  <SelectTrigger className="w-[140px]" data-testid={`select-plan-${user.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Account Status</p>
                <Select value={user.status} onValueChange={(status) => updateUserMutation.mutate({ id: user.id, data: { status } })}>
                  <SelectTrigger className="w-[140px]" data-testid={`select-status-${user.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="banned">Banned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {user.stripeSubscriptionId && (
              <div className="p-3 bg-muted/50 rounded-md">
                <p className="text-xs text-muted-foreground mb-0.5">Stripe Subscription</p>
                <p className="text-xs font-mono">{user.stripeSubscriptionId}</p>
                {user.stripeCustomerId && (
                  <>
                    <p className="text-xs text-muted-foreground mt-1 mb-0.5">Stripe Customer</p>
                    <p className="text-xs font-mono">{user.stripeCustomerId}</p>
                  </>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button size="sm" variant="outline" onClick={() => setGrantOpen(true)} data-testid={`button-grant-credits-${user.id}`}>
                <CreditCard className="w-4 h-4 mr-1" /> Grant Credits
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReferralOpen(true)} data-testid={`button-grant-referral-${user.id}`}>
                <Gift className="w-4 h-4 mr-1" /> Referral Credits
              </Button>
              {user.plan !== "free" && (
                <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)} data-testid={`button-cancel-sub-${user.id}`}>
                  <Ban className="w-4 h-4 mr-1" /> Cancel Subscription
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)} data-testid={`button-credit-history-${user.id}`}>
                <History className="w-4 h-4 mr-1" /> Credit History
              </Button>
              {user.role !== "admin" && (
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)} data-testid={`button-delete-user-${user.id}`}>
                  <Trash2 className="w-4 h-4 mr-1" /> Delete User
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <GrantCreditsDialog user={user} open={grantOpen} onOpenChange={setGrantOpen} />
      <GrantReferralDialog user={user} open={referralOpen} onOpenChange={setReferralOpen} />
      <CancelSubscriptionDialog user={user} open={cancelOpen} onOpenChange={setCancelOpen} />
      <CreditHistoryDialog user={user} open={historyOpen} onOpenChange={setHistoryOpen} />
      <DeleteUserDialog user={user} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}

interface RouterConfig {
  id: string;
  useCase: string;
  primaryProvider: string;
  primaryModel: string;
  fallbackProvider: string | null;
  fallbackModel: string | null;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  streamingEnabled: boolean;
}

const USE_CASE_LABELS: Record<string, string> = {
  QUESTION_CLASSIFIER: "Question Classifier",
  QUESTION_NORMALIZER: "Question Normalizer",
  LIVE_INTERVIEW_ANSWER: "Live Interview Answer",
  SUMMARY_UPDATER: "Summary Updater",
  FACT_EXTRACTOR: "Fact Extractor",
  CODING_ASSIST: "Coding Assist",
  ADMIN_TEST_PROMPT: "Admin Test Prompt",
};

function RouterConfigTab() {
  const { toast } = useToast();
  const [editingUseCase, setEditingUseCase] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<RouterConfig>>({});
  const [testPrompt, setTestPrompt] = useState("");
  const [testResult, setTestResult] = useState("");
  const [testing, setTesting] = useState(false);

  const { data: configs = [], isLoading } = useQuery<RouterConfig[]>({
    queryKey: ["/api/admin/router-config"],
  });

  const { data: metrics = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/llm-metrics"],
  });

  const updateMutation = useMutation({
    mutationFn: async (config: Partial<RouterConfig> & { useCase: string }) => {
      const res = await apiRequest("PUT", `/api/admin/router-config/${config.useCase}`, config);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/router-config"] });
      setEditingUseCase(null);
      toast({ title: "Router config updated" });
    },
    onError: (err: any) => toast({ title: "Failed to update", description: err.message, variant: "destructive" }),
  });

  const startEdit = (config: RouterConfig) => {
    setEditingUseCase(config.useCase);
    setEditForm({ ...config });
  };

  const saveEdit = () => {
    if (!editingUseCase) return;
    updateMutation.mutate({ useCase: editingUseCase, ...editForm });
  };

  const avgLatency = metrics.length > 0
    ? Math.round(metrics.reduce((s, m) => s + (m.latencyMs || 0), 0) / metrics.length)
    : 0;
  const successRate = metrics.length > 0
    ? Math.round((metrics.filter(m => m.success).length / metrics.length) * 100)
    : 100;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <BarChart2 className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium">Avg Latency</p>
          </div>
          <p className="text-2xl font-bold" data-testid="text-avg-latency">{avgLatency}ms</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <p className="text-sm font-medium">Success Rate</p>
          </div>
          <p className="text-2xl font-bold" data-testid="text-success-rate">{successRate}%</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-blue-500" />
            <p className="text-sm font-medium">Total Calls</p>
          </div>
          <p className="text-2xl font-bold" data-testid="text-total-calls">{metrics.length}</p>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {configs.map((config) => (
            <Card key={config.useCase} className="p-4" data-testid={`card-router-${config.useCase}`}>
              {editingUseCase === config.useCase ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{USE_CASE_LABELS[config.useCase] || config.useCase}</h3>
                    <Badge variant="outline">{config.useCase}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Provider</label>
                      <Select value={editForm.primaryProvider || "openai"} onValueChange={(v) => setEditForm({ ...editForm, primaryProvider: v })}>
                        <SelectTrigger data-testid={`select-provider-${config.useCase}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="gemini">Gemini</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Model</label>
                      <Input value={editForm.primaryModel || ""} onChange={(e) => setEditForm({ ...editForm, primaryModel: e.target.value })} data-testid={`input-model-${config.useCase}`} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Temperature ({editForm.temperature ?? 0.5})</label>
                      <input type="range" min="0" max="1" step="0.05" value={editForm.temperature ?? 0.5} onChange={(e) => setEditForm({ ...editForm, temperature: parseFloat(e.target.value) })} className="w-full" data-testid={`slider-temp-${config.useCase}`} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Max Tokens</label>
                      <Input type="number" value={editForm.maxTokens || 500} onChange={(e) => setEditForm({ ...editForm, maxTokens: parseInt(e.target.value) })} data-testid={`input-tokens-${config.useCase}`} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Timeout (ms)</label>
                      <Input type="number" value={editForm.timeoutMs || 30000} onChange={(e) => setEditForm({ ...editForm, timeoutMs: parseInt(e.target.value) })} data-testid={`input-timeout-${config.useCase}`} />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <Switch checked={editForm.streamingEnabled || false} onCheckedChange={(v) => setEditForm({ ...editForm, streamingEnabled: v })} data-testid={`switch-streaming-${config.useCase}`} />
                      <span className="text-sm">Streaming</span>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setEditingUseCase(null)} data-testid="button-cancel-edit">Cancel</Button>
                    <Button size="sm" onClick={saveEdit} disabled={updateMutation.isPending} data-testid="button-save-config">
                      {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{USE_CASE_LABELS[config.useCase] || config.useCase}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="secondary">{config.primaryProvider}</Badge>
                      <Badge variant="outline">{config.primaryModel}</Badge>
                      <span className="text-xs text-muted-foreground">temp={config.temperature} max={config.maxTokens} timeout={config.timeoutMs}ms</span>
                      {config.streamingEnabled && <Badge className="bg-green-600 text-white text-xs">Stream</Badge>}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => startEdit(config)} data-testid={`button-edit-${config.useCase}`}>
                    <Settings className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {metrics.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><BarChart2 className="w-4 h-4" /> Recent LLM Calls</h3>
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {metrics.slice(0, 20).map((m: any, i: number) => (
              <div key={m.id || i} className="flex items-center justify-between text-xs py-1 border-b border-muted/30" data-testid={`row-metric-${i}`}>
                <div className="flex items-center gap-2">
                  <Badge variant={m.success ? "secondary" : "destructive"} className="text-[10px]">{m.success ? "OK" : "ERR"}</Badge>
                  <span className="font-mono">{m.useCase}</span>
                  <span className="text-muted-foreground">{m.provider}/{m.model}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>{m.latencyMs}ms</span>
                  {m.ttftMs && <span className="text-muted-foreground">TTFT:{m.ttftMs}ms</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function SettingsTab() {
  const { toast } = useToast();
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [googleSttKey, setGoogleSttKey] = useState("");
  const [azureSpeechKey, setAzureSpeechKey] = useState("");
  const [azureSpeechRegion, setAzureSpeechRegion] = useState("");
  const [deepgramApiKey, setDeepgramApiKey] = useState("");
  const [showOpenai, setShowOpenai] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [showAzure, setShowAzure] = useState(false);
  const [showDeepgram, setShowDeepgram] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [smtpSynced, setSmtpSynced] = useState(false);
  const [testSmtpEmail, setTestSmtpEmail] = useState("");
  const { data: settings, isLoading: settingsLoading } = useQuery<any>({ queryKey: ["/api/admin/settings"] });
  const [defaultModel, setDefaultModel] = useState("gpt-4o");
  const [modelSynced, setModelSynced] = useState(false);
  const [defaultSttProvider, setDefaultSttProvider] = useState("browser");
  const [sttProviderSynced, setSttProviderSynced] = useState(false);
  const { data: models } = useQuery<{ openai: string[]; gemini: string[] }>({ queryKey: ["/api/models"] });

  if (settings?.default_model && !modelSynced) {
    setDefaultModel(settings.default_model);
    setModelSynced(true);
  }

  if (settings?.default_stt_provider && !sttProviderSynced) {
    setDefaultSttProvider(settings.default_stt_provider);
    setSttProviderSynced(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", "/api/admin/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Settings saved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    },
  });

  const smtpSaveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/settings/save-smtp", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "SMTP settings saved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save SMTP settings", description: error.message, variant: "destructive" });
    },
  });

  const testSmtpMutation = useMutation({
    mutationFn: async (data: { email?: string }) => {
      const res = await apiRequest("POST", "/api/admin/settings/test-smtp", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "SMTP Test", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "SMTP Test Failed", description: error.message, variant: "destructive" });
    },
  });

  if (settingsLoading) {
    return <Card className="p-6"><div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></Card>;
  }

  // Sync SMTP fields from settings
  if (settings && !smtpSynced) {
    setSmtpHost(settings.smtp_host || "");
    setSmtpPort(settings.smtp_port || "587");
    setSmtpUser(settings.smtp_user || "");
    setSmtpFromEmail(settings.smtp_from_email || "");
    setSmtpFromName(settings.smtp_from_name || "");
    setSmtpSynced(true);
  }

  const allModels = [
    ...(models?.openai || ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"]).map((m) => ({ id: m, provider: "OpenAI" })),
    ...(models?.gemini || ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]).map((m) => ({ id: m, provider: "Gemini" })),
  ];

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Key className="w-4 h-4 text-primary" /> API Keys</h3>
        <p className="text-xs text-muted-foreground mb-4">Manage your AI provider API keys.</p>
        <div className="space-y-4">
          <div className="p-4 border rounded-md space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-medium text-sm">OpenAI API Key</p>
                <p className="text-xs text-muted-foreground">
                  {settings?.openai_env_set ? "Environment variable is set" : settings?.openai_api_key_set ? `Custom key: ${settings.openai_api_key}` : "Not configured"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${settings?.openai_env_set || settings?.openai_api_key_set ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                <span className="text-xs text-muted-foreground">{settings?.openai_env_set || settings?.openai_api_key_set ? "Active" : "Inactive"}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input type={showOpenai ? "text" : "password"} value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} placeholder="sk-..." data-testid="input-openai-key" />
                <Button variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowOpenai(!showOpenai)} data-testid="button-toggle-openai-visibility">
                  {showOpenai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <Button size="sm" onClick={() => { saveMutation.mutate({ openai_api_key: openaiKey }); setOpenaiKey(""); }} disabled={!openaiKey || saveMutation.isPending} data-testid="button-save-openai">
                <Save className="w-4 h-4 mr-1" /> Save
              </Button>
            </div>
          </div>

          <div className="p-4 border rounded-md space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-medium text-sm">Google Gemini API Key</p>
                <p className="text-xs text-muted-foreground">{settings?.gemini_api_key_set ? `Key: ${settings.gemini_api_key}` : "Not configured"}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${settings?.gemini_api_key_set ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                <span className="text-xs text-muted-foreground">{settings?.gemini_api_key_set ? "Active" : "Inactive"}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input type={showGemini ? "text" : "password"} value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="AI..." data-testid="input-gemini-key" />
                <Button variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowGemini(!showGemini)} data-testid="button-toggle-gemini-visibility">
                  {showGemini ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <Button size="sm" onClick={() => { saveMutation.mutate({ gemini_api_key: geminiKey }); setGeminiKey(""); }} disabled={!geminiKey || saveMutation.isPending} data-testid="button-save-gemini">
                <Save className="w-4 h-4 mr-1" /> Save
              </Button>
            </div>
          </div>

          <div className="p-4 border rounded-md space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-medium text-sm">Google Cloud STT Service Account</p>
                <p className="text-xs text-muted-foreground">{settings?.google_stt_credentials_set ? `Project: ${settings.google_stt_credentials}` : "Not configured (optional - for streaming speech-to-text)"}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${settings?.google_stt_credentials_set ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                <span className="text-xs text-muted-foreground">{settings?.google_stt_credentials_set ? "Active" : "Inactive"}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Textarea
                value={googleSttKey}
                onChange={(e) => setGoogleSttKey(e.target.value)}
                placeholder='Paste your Google Cloud service account JSON here...&#10;{&#10;  "type": "service_account",&#10;  "project_id": "...",&#10;  ...&#10;}'
                className="resize-none font-mono text-xs"
                rows={6}
                data-testid="input-google-stt-credentials"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground">Paste the full JSON service account key file contents</p>
                <Button size="sm" onClick={() => {
                  try {
                    const parsed = JSON.parse(googleSttKey);
                    if (!parsed.type || parsed.type !== "service_account") {
                      toast({ title: "Invalid format", description: "JSON must be a Google Cloud service account key", variant: "destructive" });
                      return;
                    }
                    saveMutation.mutate({ google_stt_credentials: googleSttKey });
                    setGoogleSttKey("");
                  } catch {
                    toast({ title: "Invalid JSON", description: "Please paste valid JSON service account credentials", variant: "destructive" });
                  }
                }} disabled={!googleSttKey || saveMutation.isPending} data-testid="button-save-google-stt">
                  <Save className="w-4 h-4 mr-1" /> Save
                </Button>
              </div>
            </div>
          </div>
          <div className="p-4 border rounded-md space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-medium text-sm">Azure Speech Service</p>
                <p className="text-xs text-muted-foreground">
                  {settings?.azure_speech_key_set
                    ? `Key: ••••••••••••${settings.azure_speech_key_last4 || ""} | Region: ${settings.azure_speech_region || "not set"}`
                    : "Not configured (recommended for smooth real-time transcription)"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${settings?.azure_speech_key_set ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                <span className="text-xs text-muted-foreground">{settings?.azure_speech_key_set ? "Active" : "Inactive"}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input type={showAzure ? "text" : "password"} value={azureSpeechKey} onChange={(e) => setAzureSpeechKey(e.target.value)} placeholder="Azure Speech subscription key..." data-testid="input-azure-speech-key" />
                  <Button variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowAzure(!showAzure)} data-testid="button-toggle-azure-visibility">
                    {showAzure ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input value={azureSpeechRegion} onChange={(e) => setAzureSpeechRegion(e.target.value)} placeholder="Region(s) (e.g. eastus,centralus,westus2)" className="flex-1" data-testid="input-azure-speech-region" />
                <Button size="sm" onClick={() => {
                  if (!azureSpeechKey && !azureSpeechRegion) return;
                  const data: any = {};
                  if (azureSpeechKey) data.azure_speech_key = azureSpeechKey;
                  if (azureSpeechRegion) data.azure_speech_region = azureSpeechRegion;
                  saveMutation.mutate(data);
                  setAzureSpeechKey("");
                  setAzureSpeechRegion("");
                }} disabled={(!azureSpeechKey && !azureSpeechRegion) || saveMutation.isPending} data-testid="button-save-azure">
                  <Save className="w-4 h-4 mr-1" /> Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Azure Speech provides the smoothest real-time transcription with partial updates. Key is never sent to the browser - only short-lived tokens are minted. You can enter multiple regions (comma-separated) for automatic nearest-region selection and failover.</p>
            </div>
          </div>

          <div className="p-4 border rounded-md space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-medium text-sm">Deepgram Live STT</p>
                <p className="text-xs text-muted-foreground">
                  {settings?.deepgram_api_key_set
                    ? `Key: ••••••••••••${settings.deepgram_api_key_last4 || ""}`
                    : "Not configured (optional - real-time Deepgram transcription)"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${settings?.deepgram_api_key_set ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                <span className="text-xs text-muted-foreground">{settings?.deepgram_api_key_set ? "Active" : "Inactive"}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input type={showDeepgram ? "text" : "password"} value={deepgramApiKey} onChange={(e) => setDeepgramApiKey(e.target.value)} placeholder="Deepgram API key..." data-testid="input-deepgram-api-key" />
                  <Button variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowDeepgram(!showDeepgram)} data-testid="button-toggle-deepgram-visibility">
                    {showDeepgram ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                <Button size="sm" onClick={() => { saveMutation.mutate({ deepgram_api_key: deepgramApiKey }); setDeepgramApiKey(""); }} disabled={!deepgramApiKey || saveMutation.isPending} data-testid="button-save-deepgram">
                  <Save className="w-4 h-4 mr-1" /> Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Deepgram is stored server-side and used only to mint short-lived browser tokens for live transcription.</p>
            </div>
          </div>

          <div className="p-4 border rounded-md space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-medium text-sm">Default STT Provider</p>
                <p className="text-xs text-muted-foreground">Choose the live transcription engine that Zoommate should prefer by default.</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="uppercase">{defaultSttProvider}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={defaultSttProvider} onValueChange={setDefaultSttProvider}>
                <SelectTrigger className="flex-1" data-testid="select-default-stt-provider">
                  <SelectValue placeholder="Choose a provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="azure">Azure Speech</SelectItem>
                  <SelectItem value="deepgram">Deepgram</SelectItem>
                  <SelectItem value="browser">Browser Speech API</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => saveMutation.mutate({ default_stt_provider: defaultSttProvider })} disabled={saveMutation.isPending} data-testid="button-save-default-stt-provider">
                <Save className="w-4 h-4 mr-1" /> Save
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Mail className="w-4 h-4 text-primary" /> Email / SMTP Settings</h3>
        <p className="text-xs text-muted-foreground mb-4">Configure SMTP for sending email verification codes to new users.</p>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">SMTP Host</label>
              <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="e.g. smtp.gmail.com" data-testid="input-smtp-host" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">SMTP Port</label>
              <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" data-testid="input-smtp-port" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">SMTP Username</label>
              <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="your-email@example.com" data-testid="input-smtp-user" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">SMTP Password</label>
              <div className="relative">
                <Input type={showSmtpPass ? "text" : "password"} value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder={settings?.smtp_pass_set ? "••••••••(already set)" : "App password or SMTP password"} data-testid="input-smtp-pass" />
                <Button variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowSmtpPass(!showSmtpPass)} data-testid="button-toggle-smtp-pass">
                  {showSmtpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">From Email</label>
              <Input value={smtpFromEmail} onChange={(e) => setSmtpFromEmail(e.target.value)} placeholder="noreply@yourdomain.com" data-testid="input-smtp-from-email" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">From Name</label>
              <Input value={smtpFromName} onChange={(e) => setSmtpFromName(e.target.value)} placeholder="Zoom Mate" data-testid="input-smtp-from-name" />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => {
              smtpSaveMutation.mutate({
                smtp_host: smtpHost,
                smtp_port: smtpPort,
                smtp_user: smtpUser,
                smtp_pass: smtpPass,
                smtp_from_email: smtpFromEmail,
                smtp_from_name: smtpFromName,
              });
              setSmtpPass("");
            }} disabled={!smtpHost || !smtpUser || smtpSaveMutation.isPending} data-testid="button-save-smtp">
              {smtpSaveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Save SMTP Settings
            </Button>
            <div className="flex items-center gap-2">
              <Input value={testSmtpEmail} onChange={(e) => setTestSmtpEmail(e.target.value)} placeholder="Test email address" className="w-[200px]" data-testid="input-test-smtp-email" />
              <Button variant="outline" onClick={() => testSmtpMutation.mutate({ email: testSmtpEmail || undefined })} disabled={testSmtpMutation.isPending} data-testid="button-test-smtp">
                {testSmtpMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Mail className="w-4 h-4 mr-1" />}
                Send Test Email
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${settings?.smtp_host && settings?.smtp_user && settings?.smtp_pass_set ? "bg-emerald-500" : "bg-muted-foreground"}`} />
            <span className="text-xs text-muted-foreground">{settings?.smtp_host && settings?.smtp_user && settings?.smtp_pass_set ? "SMTP Configured" : "SMTP Not Configured — email verification will not work"}</span>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Settings className="w-4 h-4 text-primary" /> Default AI Model</h3>
        <p className="text-xs text-muted-foreground mb-4">Set the default AI model for new sessions.</p>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={defaultModel} onValueChange={setDefaultModel}>
            <SelectTrigger className="w-[250px]" data-testid="select-default-model"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.id} ({m.provider})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => saveMutation.mutate({ default_model: defaultModel })} disabled={saveMutation.isPending} data-testid="button-save-model">
            <Save className="w-4 h-4 mr-1" /> Save Model
          </Button>
        </div>
      </Card>
    </div>
  );
}

function AnnouncementsTab() {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState("info");

  const { data: announcements = [], isLoading } = useQuery<AnnouncementItem[]>({
    queryKey: ["/api/admin/announcements"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; message: string; type: string }) => {
      const res = await apiRequest("POST", "/api/admin/announcements", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
      toast({ title: "Announcement created" });
      setTitle("");
      setMessage("");
      setType("info");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create announcement", description: error.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/announcements/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/announcements/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
      toast({ title: "Announcement deleted" });
    },
  });

  const typeColors: Record<string, string> = {
    info: "default",
    warning: "secondary",
    critical: "destructive",
    success: "default",
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Megaphone className="w-4 h-4 text-primary" /> Create Announcement</h3>
        <p className="text-xs text-muted-foreground mb-4">Send announcements to all users.</p>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" data-testid="input-announcement-title" />
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Announcement message..." data-testid="input-announcement-message" />
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[150px]" data-testid="select-announcement-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="success">Success</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => createMutation.mutate({ title, message, type })} disabled={!title || !message || createMutation.isPending} data-testid="button-create-announcement">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Create Announcement
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold mb-4">Active Announcements</h3>
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : announcements.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No announcements yet</p>
        ) : (
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="p-4 border rounded-md" data-testid={`row-announcement-${a.id}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-medium text-sm">{a.title}</h4>
                    <Badge variant={typeColors[a.type] as any || "secondary"} className="text-xs">{a.type}</Badge>
                    {!a.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={a.isActive} onCheckedChange={(checked) => toggleMutation.mutate({ id: a.id, isActive: checked })} data-testid={`switch-announcement-${a.id}`} />
                    <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(a.id)} data-testid={`button-delete-announcement-${a.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{a.message}</p>
                <p className="text-xs text-muted-foreground mt-2">{a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ActivityTab() {
  const { data: logs = [], isLoading } = useQuery<CreditLogEntry[]>({
    queryKey: ["/api/admin/credit-logs"],
  });
  const { data: users = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const getUserName = (id: string) => {
    const user = users.find((u) => u.id === id);
    return user?.username || id.slice(0, 8);
  };

  const typeLabels: Record<string, { label: string; icon: any }> = {
    grant: { label: "Credits Granted", icon: CreditCard },
    referral: { label: "Referral Credits", icon: Gift },
    subscription_cancelled: { label: "Subscription Cancelled", icon: Ban },
  };

  if (isLoading) {
    return <Card className="p-6"><div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></Card>;
  }

  return (
    <Card className="p-6">
      <h3 className="font-semibold mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> Admin Activity Log</h3>
      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No admin activity yet</p>
      ) : (
        <ScrollArea className="max-h-[600px]">
          <div className="space-y-2">
            {logs.map((log) => {
              const info = typeLabels[log.type] || { label: log.type, icon: Activity };
              const Icon = info.icon;
              return (
                <div key={log.id} className="p-3 border rounded-md flex items-start gap-3" data-testid={`row-activity-${log.id}`}>
                  <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{info.label}</span>
                      {log.amount > 0 && <Badge variant="secondary" className="text-xs">+{log.amount}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      User: {getUserName(log.userId)} | By: {getUserName(log.adminId)}
                    </p>
                    {log.reason && <p className="text-xs text-muted-foreground mt-0.5">{log.reason}</p>}
                    <p className="text-xs text-muted-foreground mt-0.5">{log.createdAt ? new Date(log.createdAt).toLocaleString() : "N/A"}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </Card>
  );
}

interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  metadata: any;
  active: boolean;
  prices: { id: string; unit_amount: number; currency: string; recurring: any; active: boolean }[];
}

function PricingTab() {
  const { toast } = useToast();
  const [newProductName, setNewProductName] = useState("");
  const [newProductDesc, setNewProductDesc] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductInterval, setNewProductInterval] = useState("month");
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [addingPriceFor, setAddingPriceFor] = useState<string | null>(null);
  const [addPriceAmount, setAddPriceAmount] = useState("");
  const [addPriceInterval, setAddPriceInterval] = useState("month");

  const { data: currentUser } = useQuery<{ id: string; role: string }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: products = [], isLoading } = useQuery<StripeProduct[]>({
    queryKey: ["/api/admin/stripe/products"],
    enabled: currentUser?.role === "admin",
  });

  const createProductMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; price: number; interval: string }) => {
      const res = await apiRequest("POST", "/api/admin/stripe/products", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stripe/products"] });
      toast({ title: "Product created successfully" });
      setNewProductName("");
      setNewProductDesc("");
      setNewProductPrice("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create product", description: error.message, variant: "destructive" });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/stripe/products/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stripe/products"] });
      toast({ title: "Product updated" });
      setEditingProduct(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update product", description: error.message, variant: "destructive" });
    },
  });

  const togglePriceMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/stripe/prices/${id}`, { active });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stripe/products"] });
      toast({ title: "Price updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update price", description: error.message, variant: "destructive" });
    },
  });

  const addPriceMutation = useMutation({
    mutationFn: async (data: { productId: string; price: number; interval: string }) => {
      const res = await apiRequest("POST", "/api/admin/stripe/prices", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stripe/products"] });
      toast({ title: "Price added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add price", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <Card className="p-6"><div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></Card>;
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> Create Subscription Plan</h3>
        <p className="text-xs text-muted-foreground mb-4">Add a new subscription plan to Stripe. This will create both a product and its price.</p>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-sm font-medium mb-1.5">Plan Name</p>
              <Input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="e.g., Standard Plan" data-testid="input-product-name" />
            </div>
            <div>
              <p className="text-sm font-medium mb-1.5">Description</p>
              <Input value={newProductDesc} onChange={(e) => setNewProductDesc(e.target.value)} placeholder="e.g., Best for individuals" data-testid="input-product-desc" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-sm font-medium mb-1.5">Price (USD)</p>
              <Input type="number" min="0" step="0.01" value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} placeholder="14.99" data-testid="input-product-price" />
            </div>
            <div>
              <p className="text-sm font-medium mb-1.5">Billing Interval</p>
              <Select value={newProductInterval} onValueChange={setNewProductInterval}>
                <SelectTrigger data-testid="select-product-interval"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Monthly</SelectItem>
                  <SelectItem value="year">Yearly</SelectItem>
                  <SelectItem value="week">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={() => createProductMutation.mutate({ name: newProductName, description: newProductDesc, price: parseFloat(newProductPrice), interval: newProductInterval })}
            disabled={!newProductName || !newProductPrice || parseFloat(newProductPrice) <= 0 || createProductMutation.isPending}
            data-testid="button-create-product"
          >
            {createProductMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
            Create Plan
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /> Subscription Plans ({products.length})</h3>
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No subscription plans yet. Create one above.</p>
        ) : (
          <div className="space-y-3">
            {products.map((product) => (
              <div key={product.id} className="p-4 border rounded-md" data-testid={`row-product-${product.id}`}>
                <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {editingProduct === product.id ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-[200px]" data-testid={`input-edit-name-${product.id}`} />
                        <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="w-[250px]" placeholder="Description" data-testid={`input-edit-desc-${product.id}`} />
                        <Button size="sm" onClick={() => updateProductMutation.mutate({ id: product.id, data: { name: editName, description: editDesc } })} disabled={updateProductMutation.isPending} data-testid={`button-save-edit-${product.id}`}>
                          <Save className="w-3 h-3 mr-1" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingProduct(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <>
                        <h4 className="font-medium text-sm">{product.name}</h4>
                        {product.description && <span className="text-xs text-muted-foreground">- {product.description}</span>}
                        <Badge variant={product.active ? "default" : "secondary"} className="text-xs">{product.active ? "Active" : "Inactive"}</Badge>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {editingProduct !== product.id && (
                      <Button size="sm" variant="ghost" onClick={() => { setEditingProduct(product.id); setEditName(product.name); setEditDesc(product.description || ""); }} data-testid={`button-edit-product-${product.id}`}>
                        <Settings className="w-3 h-3 mr-1" /> Edit
                      </Button>
                    )}
                    <Switch
                      checked={product.active}
                      onCheckedChange={(checked) => updateProductMutation.mutate({ id: product.id, data: { active: checked } })}
                      data-testid={`switch-product-${product.id}`}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Prices</p>
                  {product.prices.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No prices configured</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {product.prices.map((price) => (
                        <div key={price.id} className="flex items-center gap-2 p-2 border rounded-md bg-muted/30" data-testid={`row-price-${price.id}`}>
                          <span className="text-sm font-semibold">${(price.unit_amount / 100).toFixed(2)}</span>
                          <span className="text-xs text-muted-foreground">/{price.recurring?.interval || "month"}</span>
                          <Badge variant={price.active ? "default" : "secondary"} className="text-xs">{price.active ? "Active" : "Inactive"}</Badge>
                          <Switch
                            checked={price.active}
                            onCheckedChange={(checked) => togglePriceMutation.mutate({ id: price.id, active: checked })}
                            data-testid={`switch-price-${price.id}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {addingPriceFor === product.id ? (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Input type="number" min="0" step="0.01" value={addPriceAmount} onChange={(e) => setAddPriceAmount(e.target.value)} placeholder="Price (USD)" className="w-[120px]" data-testid={`input-add-price-${product.id}`} />
                      <Select value={addPriceInterval} onValueChange={setAddPriceInterval}>
                        <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="month">Monthly</SelectItem>
                          <SelectItem value="year">Yearly</SelectItem>
                          <SelectItem value="week">Weekly</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" onClick={() => { addPriceMutation.mutate({ productId: product.id, price: parseFloat(addPriceAmount), interval: addPriceInterval }); setAddingPriceFor(null); setAddPriceAmount(""); }} disabled={!addPriceAmount || parseFloat(addPriceAmount) <= 0} data-testid={`button-confirm-add-price-${product.id}`}>
                        <Plus className="w-3 h-3 mr-1" /> Add
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setAddingPriceFor(null); setAddPriceAmount(""); }}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAddingPriceFor(product.id)} data-testid={`button-add-price-${product.id}`}>
                      <Plus className="w-3 h-3 mr-1" /> Add Price
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2 font-mono">{product.id}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SessionsTab() {
  const { data: meetings = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/meetings"],
  });
  const { data: users = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const getUserName = (id: string) => {
    const user = users.find((u) => u.id === id);
    return user?.username || id.slice(0, 8);
  };

  if (isLoading) {
    return <Card className="p-6"><div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></Card>;
  }

  const statusColors: Record<string, string> = {
    active: "default",
    completed: "secondary",
    setup: "secondary",
    paused: "secondary",
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <h3 className="font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary" /> All Sessions ({meetings.length})</h3>
        <Button variant="outline" size="sm" onClick={() => window.open("/api/admin/export/sessions", "_blank")} data-testid="button-export-sessions">
          <Download className="w-4 h-4 mr-1" /> Export CSV
        </Button>
      </div>
      {meetings.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No sessions yet</p>
      ) : (
        <ScrollArea className="max-h-[600px]">
          <div className="space-y-2">
            {meetings.slice(0, 100).map((m: any) => (
              <div key={m.id} className="p-3 border rounded-md" data-testid={`row-session-${m.id}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="font-medium text-sm">{m.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      User: {getUserName(m.userId)} | Type: {m.type} | Model: {m.model}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={statusColors[m.status] as any || "secondary"} className="text-xs">{m.status}</Badge>
                    <Badge variant="secondary" className="text-xs">{m.totalMinutes || 0} min</Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </Card>
  );
}

export default function AdminPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  const { data: currentUser, isLoading: userLoading } = useQuery<{ id: string; username: string; role: string }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: currentUser?.role === "admin",
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: currentUser?.role === "admin",
  });

  const maintenanceMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/admin/maintenance", { enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: stats?.maintenanceMode ? "Maintenance mode disabled" : "Maintenance mode enabled" });
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ userIds, status }: { userIds: string[]; status: string }) => {
      const res = await apiRequest("POST", "/api/admin/users/bulk-status", { userIds, status });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: data.message });
      setSelectedUsers([]);
    },
    onError: (error: Error) => {
      toast({ title: "Bulk action failed", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!userLoading && (!currentUser || currentUser.role !== "admin")) {
      navigate("/dashboard");
    }
  }, [currentUser, userLoading, navigate]);

  if (userLoading || !currentUser || currentUser.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const filteredUsers = users.filter((u) => {
    const matchesSearch = !searchQuery ||
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesPlan = filterPlan === "all" || u.plan === filterPlan;
    const matchesStatus = filterStatus === "all" || u.status === filterStatus;
    return matchesSearch && matchesPlan && matchesStatus;
  });

  const handleSelectUser = (userId: string, checked: boolean) => {
    if (checked) {
      setSelectedUsers((prev) => [...prev, userId]);
    } else {
      setSelectedUsers((prev) => prev.filter((id) => id !== userId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedUsers(filteredUsers.filter((u) => u.role !== "admin").map((u) => u.id));
    } else {
      setSelectedUsers([]);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b sticky top-0 z-50 bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" data-testid="link-back-dashboard"><ArrowLeft className="w-4 h-4" /></Button>
            </Link>
            <Link href="/dashboard">
              <a className="flex items-center gap-2" data-testid="link-logo-home">
                <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
                  <Zap className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-bold">Zoom Mate</span>
                <Badge variant="secondary">Admin</Badge>
              </a>
            </Link>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {stats?.maintenanceMode && (
              <Badge variant="destructive" className="text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" /> Maintenance Mode
              </Badge>
            )}
            <ThemeToggle />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-admin-title">Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1">Manage users, monitor system health, and configure settings</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Maintenance</span>
                <Switch
                  checked={stats?.maintenanceMode || false}
                  onCheckedChange={(checked) => maintenanceMutation.mutate(checked)}
                  data-testid="switch-maintenance-mode"
                />
              </div>
            </div>
          </div>

          {statsLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : stats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Total Users</p>
                </div>
                <p className="text-2xl font-bold" data-testid="text-stat-users">{stats.totalUsers}</p>
                <p className="text-xs text-muted-foreground">{stats.activeUsers} active</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Paid Users</p>
                </div>
                <p className="text-2xl font-bold" data-testid="text-stat-paid">{stats.paidUsers}</p>
                <p className="text-xs text-muted-foreground">${stats.revenueEstimate.toFixed(2)}/mo</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Sessions</p>
                </div>
                <p className="text-2xl font-bold" data-testid="text-stat-sessions">{stats.totalSessions}</p>
                <p className="text-xs text-muted-foreground">{stats.activeSessions} active</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Responses</p>
                </div>
                <p className="text-2xl font-bold" data-testid="text-stat-responses">{stats.totalResponses}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <UserPlus className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">New Today</p>
                </div>
                <p className="text-2xl font-bold" data-testid="text-stat-new-today">{stats.newUsersToday}</p>
                <p className="text-xs text-muted-foreground">{stats.newUsersThisWeek} this week</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <CreditCard className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Credits</p>
                </div>
                <p className="text-2xl font-bold" data-testid="text-stat-credits">{stats.totalCredits}</p>
                <p className="text-xs text-muted-foreground">{stats.totalReferralCredits} referral</p>
              </Card>
            </div>
          )}

          <Tabs defaultValue="users" className="space-y-4">
            <TabsList className="flex flex-wrap gap-1" data-testid="tabs-admin">
              <TabsTrigger value="users" data-testid="tab-users"><Users className="w-4 h-4 mr-1" /> Users</TabsTrigger>
              <TabsTrigger value="pricing" data-testid="tab-pricing"><DollarSign className="w-4 h-4 mr-1" /> Pricing</TabsTrigger>
              <TabsTrigger value="sessions" data-testid="tab-sessions"><MessageSquare className="w-4 h-4 mr-1" /> Sessions</TabsTrigger>
              <TabsTrigger value="announcements" data-testid="tab-announcements"><Megaphone className="w-4 h-4 mr-1" /> Announcements</TabsTrigger>
              <TabsTrigger value="activity" data-testid="tab-activity"><Activity className="w-4 h-4 mr-1" /> Activity</TabsTrigger>
              <TabsTrigger value="router" data-testid="tab-router"><Router className="w-4 h-4 mr-1" /> LLM Router</TabsTrigger>
              <TabsTrigger value="settings" data-testid="tab-settings"><Settings className="w-4 h-4 mr-1" /> Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="space-y-4">
              <Card className="p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search users by name or email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                      data-testid="input-search-users"
                    />
                  </div>
                  <Select value={filterPlan} onValueChange={setFilterPlan}>
                    <SelectTrigger className="w-[130px]" data-testid="select-filter-plan"><SelectValue placeholder="Plan" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Plans</SelectItem>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-[130px]" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="banned">Banned</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => window.open("/api/admin/export/users", "_blank")} data-testid="button-export-users">
                    <Download className="w-4 h-4 mr-1" /> Export CSV
                  </Button>
                </div>

                {selectedUsers.length > 0 && (
                  <div className="mt-3 p-3 bg-muted/50 rounded-md flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-medium">{selectedUsers.length} users selected</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => bulkStatusMutation.mutate({ userIds: selectedUsers, status: "active" })} disabled={bulkStatusMutation.isPending} data-testid="button-bulk-activate">
                        <CheckCircle className="w-4 h-4 mr-1" /> Activate
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => bulkStatusMutation.mutate({ userIds: selectedUsers, status: "suspended" })} disabled={bulkStatusMutation.isPending} data-testid="button-bulk-suspend">
                        <XCircle className="w-4 h-4 mr-1" /> Suspend
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => bulkStatusMutation.mutate({ userIds: selectedUsers, status: "banned" })} disabled={bulkStatusMutation.isPending} data-testid="button-bulk-ban">
                        <UserX className="w-4 h-4 mr-1" /> Ban
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedUsers([])} data-testid="button-clear-selection">Clear</Button>
                    </div>
                  </div>
                )}
              </Card>

              <div className="flex items-center gap-2 px-1">
                <input
                  type="checkbox"
                  checked={selectedUsers.length === filteredUsers.filter((u) => u.role !== "admin").length && filteredUsers.length > 0}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="w-4 h-4 rounded border-muted-foreground"
                  data-testid="checkbox-select-all"
                />
                <p className="text-sm text-muted-foreground">
                  {filteredUsers.length} users {searchQuery || filterPlan !== "all" || filterStatus !== "all" ? "(filtered)" : ""}
                </p>
              </div>

              {usersLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : (
                <div className="space-y-2">
                  {filteredUsers.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      selected={selectedUsers.includes(user.id)}
                      onSelect={(checked) => handleSelectUser(user.id, checked)}
                    />
                  ))}
                  {filteredUsers.length === 0 && (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      {searchQuery ? "No users match your search" : "No users found"}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="pricing">
              <PricingTab />
            </TabsContent>

            <TabsContent value="sessions">
              <SessionsTab />
            </TabsContent>

            <TabsContent value="announcements">
              <AnnouncementsTab />
            </TabsContent>

            <TabsContent value="activity">
              <ActivityTab />
            </TabsContent>

            <TabsContent value="router">
              <RouterConfigTab />
            </TabsContent>

            <TabsContent value="settings">
              <SettingsTab />
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
      <div className="max-w-7xl mx-auto px-4 pb-6">
        <p className="text-xs text-muted-foreground text-center">Version 1.1.codex</p>
      </div>
    </div>
  );
}

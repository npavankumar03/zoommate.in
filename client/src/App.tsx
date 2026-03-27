import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import { LoginPage, SignupPage } from "@/pages/auth";
import Dashboard from "@/pages/dashboard";
import MeetingSession from "@/pages/meeting-session";
import AdminPanel from "@/pages/admin";
import Download from "@/pages/download";
import SessionDetail from "@/pages/session-detail";
import OverlayPopup from "@/pages/overlay-popup";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/meeting/:id" component={MeetingSession} />
      <Route path="/session/:id" component={SessionDetail} />
      <Route path="/admin" component={AdminPanel} />
      <Route path="/download" component={Download} />
      <Route path="/overlay" component={OverlayPopup} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;

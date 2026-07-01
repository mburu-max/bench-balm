import { useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

// Blocks the app for admin-provisioned users until they replace their temporary
// password. The flag (user_metadata.must_change_password) is set by the
// admin-create-user edge function and cleared here once a new password is set.
export function ForcePasswordGate({ children }: { children: ReactNode }) {
  const { data: user, isLoading, refetch } = useQuery({
    queryKey: ["auth-user-meta"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: 0,
  });

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);

  if (isLoading) return null;
  const mustChange = !!user?.user_metadata?.must_change_password;
  if (!mustChange) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) return toast.error("Password must be at least 6 characters");
    if (pw !== pw2) return toast.error("Passwords do not match");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({
      password: pw,
      data: { must_change_password: false },
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated — welcome!");
    await refetch();
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background p-6">
      <Card className="w-full max-w-md p-8">
        <div className="size-10 rounded-md bg-primary text-primary-foreground grid place-items-center">
          <KeyRound className="size-5" />
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight mt-4">Set your password</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your account was created with a temporary password. Choose a new one to continue.
        </p>
        <form onSubmit={submit} className="space-y-4 mt-6">
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input type="password" required minLength={6} value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Saving…" : "Set password & continue"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

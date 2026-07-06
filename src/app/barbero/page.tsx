import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSalonConfig } from "@/lib/salon";
import Dashboard from "./Dashboard";

export const dynamic = "force-dynamic";

export default async function BarberoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/barbero/login");

  const { data: barber } = await supabase
    .from("barbers")
    .select("id, name")
    .eq("id", user.id)
    .single();

  const config = await getSalonConfig();

  return (
    <Dashboard
      config={config}
      barberId={user.id}
      barberName={barber?.name ?? "Barbero"}
    />
  );
}

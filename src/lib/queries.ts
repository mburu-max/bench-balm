import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("customer_name");
      if (error) throw error;
      return data;
    },
  });
}

export function useProjects(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["projects"],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, customers(customer_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useResources() {
  return useQuery({
    queryKey: ["resources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
}

export function useAllocations(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["allocations"],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*, projects(project_code, project_description, status, project_manager_user_id), customers(customer_name), resources(full_name, status)")
        .order("allocation_start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

// Allocation Report (July 10 sync): a flat, cross-service-line view of every project allocation
// — resource, customer, project code, %, and HubSpot deal id — for Governance / Finance to slice
// by service line, customer or project and export. Its own select so the shared useAllocations
// query stays untouched; RLS on allocations/projects is USING(true) so Finance sees everything.
export function useAllocationReport(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["allocation-report"],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select(
          "id, allocation_pct, allocation_type, allocation_start_date, allocation_end_date, omni_id, projects(project_code, service_line, hubspot_deal_id, status), customers(customer_name), resources(full_name, omni_id, service_line, status)",
        )
        .order("allocation_start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export type CustomerRow = NonNullable<ReturnType<typeof useCustomers>["data"]>[number];
export type ProjectRow = NonNullable<ReturnType<typeof useProjects>["data"]>[number];
export type ResourceRow = NonNullable<ReturnType<typeof useResources>["data"]>[number];
export type AllocationRow = NonNullable<ReturnType<typeof useAllocations>["data"]>[number];

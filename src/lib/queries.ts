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

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
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

export function useAllocations() {
  return useQuery({
    queryKey: ["allocations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*, projects(project_code, project_description, status), customers(customer_name), resources(full_name, status)")
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

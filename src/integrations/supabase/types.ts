export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      allocation_snapshots: {
        Row: {
          allocation_end_date: string | null
          allocation_pct: number | null
          allocation_start_date: string | null
          allocation_type: string | null
          created_at: string
          customer_name: string | null
          id: string
          manager: string | null
          omni_id: string | null
          project_code: string | null
          project_id: string | null
          resource_id: string | null
          resource_name: string | null
          role: string | null
          service_line: string | null
          snapshot_date: string
        }
        Insert: {
          allocation_end_date?: string | null
          allocation_pct?: number | null
          allocation_start_date?: string | null
          allocation_type?: string | null
          created_at?: string
          customer_name?: string | null
          id?: string
          manager?: string | null
          omni_id?: string | null
          project_code?: string | null
          project_id?: string | null
          resource_id?: string | null
          resource_name?: string | null
          role?: string | null
          service_line?: string | null
          snapshot_date: string
        }
        Update: {
          allocation_end_date?: string | null
          allocation_pct?: number | null
          allocation_start_date?: string | null
          allocation_type?: string | null
          created_at?: string
          customer_name?: string | null
          id?: string
          manager?: string | null
          omni_id?: string | null
          project_code?: string | null
          project_id?: string | null
          resource_id?: string | null
          resource_name?: string | null
          role?: string | null
          service_line?: string | null
          snapshot_date?: string
        }
        Relationships: []
      }
      allocations: {
        Row: {
          allocation_end_date: string
          allocation_model:
            | Database["public"]["Enums"]["allocation_model"]
            | null
          allocation_pct: number
          allocation_start_date: string
          allocation_type: Database["public"]["Enums"]["allocation_type"]
          created_at: string
          created_by: string | null
          customer_id: string | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          id: string
          location: string | null
          manager: string | null
          omni_id: string
          project_id: string | null
          remarks: string | null
          resource_id: string
          resource_name: string
          resource_status: Database["public"]["Enums"]["resource_status"] | null
          role: string | null
          service_line: Database["public"]["Enums"]["service_line"]
          updated_at: string
        }
        Insert: {
          allocation_end_date: string
          allocation_model?:
            | Database["public"]["Enums"]["allocation_model"]
            | null
          allocation_pct: number
          allocation_start_date: string
          allocation_type?: Database["public"]["Enums"]["allocation_type"]
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          id?: string
          location?: string | null
          manager?: string | null
          omni_id: string
          project_id?: string | null
          remarks?: string | null
          resource_id: string
          resource_name: string
          resource_status?:
            | Database["public"]["Enums"]["resource_status"]
            | null
          role?: string | null
          service_line: Database["public"]["Enums"]["service_line"]
          updated_at?: string
        }
        Update: {
          allocation_end_date?: string
          allocation_model?:
            | Database["public"]["Enums"]["allocation_model"]
            | null
          allocation_pct?: number
          allocation_start_date?: string
          allocation_type?: Database["public"]["Enums"]["allocation_type"]
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          id?: string
          location?: string | null
          manager?: string | null
          omni_id?: string
          project_id?: string | null
          remarks?: string | null
          resource_id?: string
          resource_name?: string
          resource_status?:
            | Database["public"]["Enums"]["resource_status"]
            | null
          role?: string | null
          service_line?: Database["public"]["Enums"]["service_line"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "allocations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "v_cliff_edge"
            referencedColumns: ["resource_id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          account_manager: string | null
          account_tier: string | null
          contract_type: string | null
          created_at: string
          created_by: string | null
          customer_name: string
          hubspot_sync_status: string
          id: string
          notes: string | null
          region: string | null
          service_lines: Database["public"]["Enums"]["service_line"][]
          updated_at: string
          vertical: string | null
        }
        Insert: {
          account_manager?: string | null
          account_tier?: string | null
          contract_type?: string | null
          created_at?: string
          created_by?: string | null
          customer_name: string
          hubspot_sync_status?: string
          id?: string
          notes?: string | null
          region?: string | null
          service_lines?: Database["public"]["Enums"]["service_line"][]
          updated_at?: string
          vertical?: string | null
        }
        Update: {
          account_manager?: string | null
          account_tier?: string | null
          contract_type?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string
          hubspot_sync_status?: string
          id?: string
          notes?: string | null
          region?: string | null
          service_lines?: Database["public"]["Enums"]["service_line"][]
          updated_at?: string
          vertical?: string | null
        }
        Relationships: []
      }
      demand_requests: {
        Row: {
          allocation_pct: number
          created_at: string
          created_by: string | null
          demand_classification:
            | Database["public"]["Enums"]["demand_classification"]
            | null
          fulfilled_at: string | null
          headcount: number
          id: string
          notes: string | null
          priority: string
          project_id: string | null
          required_from: string
          required_to: string
          role: string
          service_line: string
          status: string
          updated_at: string
        }
        Insert: {
          allocation_pct?: number
          created_at?: string
          created_by?: string | null
          demand_classification?:
            | Database["public"]["Enums"]["demand_classification"]
            | null
          fulfilled_at?: string | null
          headcount: number
          id?: string
          notes?: string | null
          priority?: string
          project_id?: string | null
          required_from: string
          required_to: string
          role: string
          service_line: string
          status?: string
          updated_at?: string
        }
        Update: {
          allocation_pct?: number
          created_at?: string
          created_by?: string | null
          demand_classification?:
            | Database["public"]["Enums"]["demand_classification"]
            | null
          fulfilled_at?: string | null
          headcount?: number
          id?: string
          notes?: string | null
          priority?: string
          project_id?: string | null
          required_from?: string
          required_to?: string
          role?: string
          service_line?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demand_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      headcount_forecast: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          month: string
          planned_headcount: number
          service_line: Database["public"]["Enums"]["service_line"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          month: string
          planned_headcount: number
          service_line: Database["public"]["Enums"]["service_line"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          month?: string
          planned_headcount?: number
          service_line?: Database["public"]["Enums"]["service_line"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          approval_notes: string | null
          client_region: string | null
          contract_signed: boolean
          created_at: string
          created_by: string | null
          customer_id: string
          delivery_center: string | null
          delivery_lead_id: string | null
          end_date: string
          governance_lead_id: string | null
          hubspot_deal_id: string | null
          id: string
          project_code: string
          project_description: string
          project_manager_id: string | null
          project_manager_user_id: string | null
          project_type: Database["public"]["Enums"]["project_type"] | null
          service_line: Database["public"]["Enums"]["service_line"]
          staffing_approved_at: string | null
          staffing_approved_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          vertical: string | null
        }
        Insert: {
          approval_notes?: string | null
          client_region?: string | null
          contract_signed?: boolean
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivery_center?: string | null
          delivery_lead_id?: string | null
          end_date: string
          governance_lead_id?: string | null
          hubspot_deal_id?: string | null
          id?: string
          project_code: string
          project_description: string
          project_manager_id?: string | null
          project_manager_user_id?: string | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          service_line: Database["public"]["Enums"]["service_line"]
          staffing_approved_at?: string | null
          staffing_approved_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          vertical?: string | null
        }
        Update: {
          approval_notes?: string | null
          client_region?: string | null
          contract_signed?: boolean
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivery_center?: string | null
          delivery_lead_id?: string | null
          end_date?: string
          governance_lead_id?: string | null
          hubspot_deal_id?: string | null
          id?: string
          project_code?: string
          project_description?: string
          project_manager_id?: string | null
          project_manager_user_id?: string | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          service_line?: Database["public"]["Enums"]["service_line"]
          staffing_approved_at?: string | null
          staffing_approved_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          vertical?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          created_at: string
          created_by: string | null
          default_allocation_type: Database["public"]["Enums"]["allocation_type"]
          department: string | null
          email: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          full_name: string
          id: string
          location: string | null
          manager_name: string | null
          omni_hr_sync_status: string
          omni_id: string
          position: string | null
          service_line: Database["public"]["Enums"]["service_line"]
          status: Database["public"]["Enums"]["resource_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_allocation_type?: Database["public"]["Enums"]["allocation_type"]
          department?: string | null
          email?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          full_name: string
          id?: string
          location?: string | null
          manager_name?: string | null
          omni_hr_sync_status?: string
          omni_id: string
          position?: string | null
          service_line: Database["public"]["Enums"]["service_line"]
          status?: Database["public"]["Enums"]["resource_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_allocation_type?: Database["public"]["Enums"]["allocation_type"]
          department?: string | null
          email?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          full_name?: string
          id?: string
          location?: string | null
          manager_name?: string | null
          omni_hr_sync_status?: string
          omni_id?: string
          position?: string | null
          service_line?: Database["public"]["Enums"]["service_line"]
          status?: Database["public"]["Enums"]["resource_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      service_lines: {
        Row: {
          buffer_pct_max: number | null
          buffer_pct_min: number | null
          created_at: string
          description: string | null
          full_name: string
          id: Database["public"]["Enums"]["service_line"]
          lead_user_id: string | null
          target_utilisation_max: number | null
          target_utilisation_min: number | null
          updated_at: string
        }
        Insert: {
          buffer_pct_max?: number | null
          buffer_pct_min?: number | null
          created_at?: string
          description?: string | null
          full_name: string
          id: Database["public"]["Enums"]["service_line"]
          lead_user_id?: string | null
          target_utilisation_max?: number | null
          target_utilisation_min?: number | null
          updated_at?: string
        }
        Update: {
          buffer_pct_max?: number | null
          buffer_pct_min?: number | null
          created_at?: string
          description?: string | null
          full_name?: string
          id?: Database["public"]["Enums"]["service_line"]
          lead_user_id?: string | null
          target_utilisation_max?: number | null
          target_utilisation_min?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_service_lines: {
        Row: {
          created_at: string
          id: string
          service_line: Database["public"]["Enums"]["service_line"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          service_line: Database["public"]["Enums"]["service_line"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          service_line?: Database["public"]["Enums"]["service_line"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_cliff_edge: {
        Row: {
          cliff_band: number | null
          days_until_cliff: number | null
          employment_type: string | null
          ending_customer_name: string | null
          ending_project_code: string | null
          full_name: string | null
          last_covered_date: string | null
          manager_name: string | null
          omni_id: string | null
          position: string | null
          resource_id: string | null
          service_line: string | null
        }
        Relationships: []
      }
      v_kpi_allocation_freshness: {
        Row: {
          pct_fresh: number | null
        }
        Relationships: []
      }
      v_kpi_avg_bench_days: {
        Row: {
          avg_bench_days: number | null
        }
        Relationships: []
      }
      v_kpi_demand_lead_time: {
        Row: {
          avg_lead_time_days: number | null
        }
        Relationships: []
      }
      v_kpi_forecast_accuracy: {
        Row: {
          accuracy_pct: number | null
          actual_headcount: number | null
          month: string | null
          planned_headcount: number | null
          service_line: Database["public"]["Enums"]["service_line"] | null
        }
        Relationships: []
      }
      v_kpi_project_code_coverage: {
        Row: {
          pct_with_project_code: number | null
        }
        Relationships: []
      }
      v_kpi_utilisation_now: {
        Row: {
          avg_utilisation_pct: number | null
          bench_count: number | null
          over_allocated_count: number | null
          service_line: Database["public"]["Enums"]["service_line"] | null
          total_active: number | null
        }
        Relationships: []
      }
      v_resource_bench_streak: {
        Row: {
          bench_since: string | null
          consecutive_bench_days: number | null
          last_seen_benched: string | null
          resource_id: string | null
        }
        Relationships: []
      }
      v_utilisation_weekly: {
        Row: {
          avg_utilisation_pct: number | null
          headcount: number | null
          service_line: string | null
          week_start: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      allocatable_resources: {
        Args: never
        Returns: {
          created_at: string
          created_by: string | null
          default_allocation_type: Database["public"]["Enums"]["allocation_type"]
          department: string | null
          email: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          full_name: string
          id: string
          location: string | null
          manager_name: string | null
          omni_hr_sync_status: string
          omni_id: string
          position: string | null
          service_line: Database["public"]["Enums"]["service_line"]
          status: Database["public"]["Enums"]["resource_status"]
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "resources"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_sl_access: {
        Args: {
          _sl: Database["public"]["Enums"]["service_line"]
          _uid?: string
        }
        Returns: boolean
      }
      is_admin_like: { Args: { _user_id: string }; Returns: boolean }
      is_developer: { Args: { _uid?: string }; Returns: boolean }
      is_dl: { Args: { _uid?: string }; Returns: boolean }
      is_finance: { Args: { _uid?: string }; Returns: boolean }
      is_governance_lead: { Args: { _uid?: string }; Returns: boolean }
      is_pm: { Args: { _uid?: string }; Returns: boolean }
      is_project_pm: {
        Args: { _project_id: string; _uid?: string }
        Returns: boolean
      }
      is_resource_role: { Args: { _uid?: string }; Returns: boolean }
      is_sl_lead: {
        Args: {
          _sl: Database["public"]["Enums"]["service_line"]
          _uid?: string
        }
        Returns: boolean
      }
      list_project_managers: {
        Args: never
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      my_allocated_project_ids: { Args: never; Returns: string[] }
      my_pm_project_ids: { Args: never; Returns: string[] }
      my_resource_ids: { Args: never; Returns: string[] }
      next_project_code: {
        Args: {
          _customer_id: string
          _sl: Database["public"]["Enums"]["service_line"]
        }
        Returns: string
      }
      pm_project_resource_ids: { Args: never; Returns: string[] }
      pm_project_service_lines: {
        Args: never
        Returns: Database["public"]["Enums"]["service_line"][]
      }
      request_leave: {
        Args: {
          _end: string
          _reason?: string
          _resource_id: string
          _start: string
        }
        Returns: string
      }
      resource_current_load: {
        Args: never
        Returns: {
          home_sl: string
          other_sl_pct: number
          resource_id: string
          total_pct: number
        }[]
      }
      return_from_leave: { Args: { _resource_id: string }; Returns: undefined }
      take_allocation_snapshot: { Args: { _d?: string }; Returns: number }
    }
    Enums: {
      allocation_model:
        | "Full_Dedication"
        | "Partial_Split"
        | "Time_Boxed"
        | "Surge_Flex"
        | "Shadow_Training"
      allocation_type: "Billable" | "Non-Billable" | "Bench" | "Leave"
      app_role:
        | "admin"
        | "governance_lead"
        | "delivery_lead"
        | "project_manager"
        | "finance"
        | "viewer"
        | "developer"
        | "service_line_lead"
        | "resource"
      demand_classification: "Confirmed" | "Probable" | "Pipeline" | "Internal"
      employment_type: "FTE" | "Contractor" | "Vendor"
      project_status:
        | "Draft"
        | "Pending_Delivery_Lead"
        | "Pending_Finance"
        | "Active"
        | "On_Hold"
        | "Closed"
        | "Rejected"
        | "Verified"
      project_type:
        | "Billable_Delivery"
        | "Non_Billable"
        | "Bench_Available"
        | "Training"
        | "Internal_Operations"
      resource_status: "Active" | "On_Leave" | "Exited"
      service_line: "DLaaS" | "CLM" | "MS" | "CCaaS" | "Legacy"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      allocation_model: [
        "Full_Dedication",
        "Partial_Split",
        "Time_Boxed",
        "Surge_Flex",
        "Shadow_Training",
      ],
      allocation_type: ["Billable", "Non-Billable", "Bench", "Leave"],
      app_role: [
        "admin",
        "governance_lead",
        "delivery_lead",
        "project_manager",
        "finance",
        "viewer",
        "developer",
        "service_line_lead",
        "resource",
      ],
      demand_classification: ["Confirmed", "Probable", "Pipeline", "Internal"],
      employment_type: ["FTE", "Contractor", "Vendor"],
      project_status: [
        "Draft",
        "Pending_Delivery_Lead",
        "Pending_Finance",
        "Active",
        "On_Hold",
        "Closed",
        "Rejected",
        "Verified",
      ],
      project_type: [
        "Billable_Delivery",
        "Non_Billable",
        "Bench_Available",
        "Training",
        "Internal_Operations",
      ],
      resource_status: ["Active", "On_Leave", "Exited"],
      service_line: ["DLaaS", "CLM", "MS", "CCaaS", "Legacy"],
    },
  },
} as const

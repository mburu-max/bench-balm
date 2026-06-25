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
      allocations: {
        Row: {
          allocation_end_date: string
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
        ]
      }
      customers: {
        Row: {
          created_at: string
          created_by: string | null
          customer_name: string
          id: string
          notes: string | null
          region: string | null
          service_lines: Database["public"]["Enums"]["service_line"][]
          updated_at: string
          vertical: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_name: string
          id?: string
          notes?: string | null
          region?: string | null
          service_lines?: Database["public"]["Enums"]["service_line"][]
          updated_at?: string
          vertical?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_name?: string
          id?: string
          notes?: string | null
          region?: string | null
          service_lines?: Database["public"]["Enums"]["service_line"][]
          updated_at?: string
          vertical?: string | null
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
          service_line: Database["public"]["Enums"]["service_line"]
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
          service_line: Database["public"]["Enums"]["service_line"]
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
          service_line?: Database["public"]["Enums"]["service_line"]
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
          omni_id: string
          position: string | null
          service_line: Database["public"]["Enums"]["service_line"]
          status: Database["public"]["Enums"]["resource_status"]
          updated_at: string
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
          omni_id: string
          position?: string | null
          service_line: Database["public"]["Enums"]["service_line"]
          status?: Database["public"]["Enums"]["resource_status"]
          updated_at?: string
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
          omni_id?: string
          position?: string | null
          service_line?: Database["public"]["Enums"]["service_line"]
          status?: Database["public"]["Enums"]["resource_status"]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      is_admin_like: { Args: { _user_id: string }; Returns: boolean }
      is_developer: { Args: { _uid?: string }; Returns: boolean }
      is_dl: { Args: { _uid?: string }; Returns: boolean }
      is_finance: { Args: { _uid?: string }; Returns: boolean }
      is_pm: { Args: { _uid?: string }; Returns: boolean }
      is_project_pm: {
        Args: { _project_id: string; _uid?: string }
        Returns: boolean
      }
    }
    Enums: {
      allocation_type: "Billable" | "Non-Billable" | "Bench" | "Leave"
      app_role:
        | "admin"
        | "governance_lead"
        | "delivery_lead"
        | "project_manager"
        | "finance"
        | "viewer"
        | "developer"
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
      allocation_type: ["Billable", "Non-Billable", "Bench", "Leave"],
      app_role: [
        "admin",
        "governance_lead",
        "delivery_lead",
        "project_manager",
        "finance",
        "viewer",
        "developer",
      ],
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
      resource_status: ["Active", "On_Leave", "Exited"],
      service_line: ["DLaaS", "CLM", "MS", "CCaaS", "Legacy"],
    },
  },
} as const

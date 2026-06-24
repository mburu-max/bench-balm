export const SERVICE_LINES = ["DLaaS", "CLM", "MS", "CCaaS", "Legacy"] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

export const ALLOCATION_TYPES = ["Billable", "Non-Billable", "Bench", "Leave"] as const;
export type AllocationType = (typeof ALLOCATION_TYPES)[number];

export const PROJECT_STATUSES = [
  "Draft",
  "Pending_Delivery_Lead",
  "Pending_Finance",
  "Active",
  "On_Hold",
  "Closed",
  "Rejected",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  Draft: "Draft",
  Pending_Delivery_Lead: "Pending Delivery Lead",
  Pending_Finance: "Pending Finance",
  Active: "Active",
  On_Hold: "On Hold",
  Closed: "Closed",
  Rejected: "Rejected",
};

export const RESOURCE_STATUSES = ["Active", "On_Leave", "Exited"] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export const EMPLOYMENT_TYPES = ["FTE", "Contractor", "Vendor"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const REGIONS = ["APAC", "EMEA", "North America", "Latin America", "Middle East"] as const;
export const VERTICALS = [
  "BFSI",
  "Healthcare",
  "Retail",
  "CPG",
  "Manufacturing",
  "Technology",
  "Energy",
  "Telecom",
  "Government",
  "Other",
] as const;

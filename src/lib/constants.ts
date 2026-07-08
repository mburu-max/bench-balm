export const SERVICE_LINES = ["DLaaS", "CLM", "MS", "CCaaS", "Legacy"] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

export const ALLOCATION_TYPES = ["Billable", "Non-Billable", "Bench", "Leave"] as const;
export type AllocationType = (typeof ALLOCATION_TYPES)[number];

// Cost/Opex framing for classifying a booking (RA "billable vs non-billable" surfaced to PMs as
// a finance decision): Cost = billable to the client, Opex = internal/non-billable overhead.
// Stored values stay the enum above; these are display-only.
export const ALLOCATION_TYPE_LABEL: Record<AllocationType, string> = {
  Billable: "Cost",
  "Non-Billable": "Opex",
  Bench: "Bench",
  Leave: "Leave",
};

// Allocation model = the engagement pattern of a resource on a project (RA doc §4.2,
// mandatory field per Dashboard Dev Tracker allocation_ledger). Distinct from % and type.
export const ALLOCATION_MODELS = [
  "Full_Dedication",
  "Partial_Split",
  "Time_Boxed",
  "Surge_Flex",
  "Shadow_Training",
] as const;
export type AllocationModel = (typeof ALLOCATION_MODELS)[number];

export const ALLOCATION_MODEL_LABEL: Record<AllocationModel, string> = {
  Full_Dedication: "Full Dedication (100%)",
  Partial_Split: "Partial Split (multi-project)",
  Time_Boxed: "Time-boxed",
  Surge_Flex: "Surge / Flex",
  Shadow_Training: "Shadow / Training",
};

export const PROJECT_STATUSES = [
  "Draft",
  "Verified",
  "Active",
  "On_Hold",
  "Closed",
  "Rejected",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  Draft: "Draft",
  Verified: "Verified",
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

// Roles (matches DB app_role enum). 'admin' & 'viewer' kept for backwards compat but unused by UI.
export const APP_ROLES = [
  "developer",
  "governance_lead",
  "finance",
  "service_line_lead",
  "project_manager",
  "resource",
] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABEL: Record<string, string> = {
  developer: "Developer",
  admin: "Developer (legacy)",
  governance_lead: "Governance Lead",
  finance: "Finance",
  service_line_lead: "Service Line Lead",
  project_manager: "Project Manager",
  resource: "Resource (self-service)",
  viewer: "Viewer",
};

import type { RoleType } from "@/lib/supabase";

export type { RoleType };

export const ROLE_TYPE_OPTIONS: ReadonlyArray<{
  value: RoleType;
  label: string;
  description: string;
}> = [
  {
    value: "general",
    label: "General",
    description: "Positions, committees, distinctions, and other groupings.",
  },
  {
    value: "pledge_class",
    label: "Pledge Class",
    description:
      "Identifies which pledge class a member joined with. Members holding a pledge-class role appear on the public members page.",
  },
  {
    value: "exec",
    label: "Executive Board",
    description:
      "An executive board position. Members holding an exec role appear on the public Executive Board section, titled with the role name.",
  },
  {
    value: "director",
    label: "Director",
    description:
      "A director position leading a committee. Grouped separately from executive board roles.",
  },
];

export type RoleRecord = {
  id: string;
  name: string;
  description: string;
  hidden: boolean;
  priority: number;
  type: RoleType;
  /** Pledge classes only: members get portal access and public listing once true. */
  is_initiated: boolean;
};

export type PermissionRecord = {
  id?: string;
  key: string;
  description: string;
};

export type RolePermissionRow = {
  role_id: string | null;
  permission_id?: string | null;
  permission_key?: string | null;
  permission?: string | null;
  key?: string | null;
};

export type CreateRoleFormState = {
  name: string;
  description: string;
  hidden: boolean;
  type: RoleType;
};

export type DropIndicator = {
  roleId: string;
  position: "before" | "after";
};

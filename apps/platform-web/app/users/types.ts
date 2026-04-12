export type CurrentUser = {
  user_id: string;
  username: string;
  role: "admin" | "owner" | "member";
  display_name: string;
};

export type UserListItem = {
  user_id: string;
  username: string;
  display_name: string;
  role: "admin" | "owner" | "member";
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
};

export type UserListResponse = {
  users: UserListItem[];
};

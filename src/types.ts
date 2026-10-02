export interface User {
  id: number;
  fullname: string;
  email: string;
  password: string;
  role: "admin" | "farmer";
  hectares: string;
  birthdate: string | null;
  age: number | null;
  gender: string | null;
  civil_status: string | null;
  address: string | null;
  contact_number: string | null;
  place_of_birth: string | null;
  profile_pic: string | null;
  is_deleted: number;
  pending_fullname: string | null;
  pending_hectares: string | null;
  has_pending_changes: number;
  created_at: string;
}
export type PublicUser = Omit<User, "password">;
export interface Complaint {
  id: number;
  farmer_id: number;
  subject: string;
  message: string;
  image_path: string | null;
  status: "pending" | "confirmed";
  confirmed_at: string | null;
  confirmed_by: number | null;
  is_deleted: number;
  created_at: string;
  fullname?: string;
}
export interface Resource {
  id: number;
  name: string;
  total_quantity: string;
  unit: string;
  description: string | null;
  is_deleted: number;
  created_at: string;
}
export interface Distribution {
  id: number;
  farmer_id: number;
  resource_id: number;
  allocated_quantity: string;
  status: "pending" | "received";
  proof_image: string | null;
  received_at: string | null;
  is_deleted: number;
  deletion_reason: string | null;
  deleted_by: number | null;
  deleted_at: string | null;
  created_at: string;
  // Exact PostgreSQL timestamp text for grouping; never submitted by the client.
  batch_key?: string;
  fullname: string;
  resource_name: string;
  unit: string;
}
export interface Notification {
  id: number;
  farmer_id: number;
  distribution_id: number | null;
  message: string;
  is_read: number;
  created_at: string;
}
export interface Activity {
  activity_key: string;
  activity_type: string;
  detail: string;
  activity_time: string;
  is_read: number;
}
export interface EmailRow {
  id: number;
  user_id: number;
  notification_id: number | null;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  attempts: number;
  recipient_name: string;
}
declare module "express-session" {
  interface SessionData {
    userId?: number;
    csrf?: string;
    flash?: { message: string; type: string };
    issuedAt?: number;
  }
}
// Express request augmentation uses the namespace required by its type definitions.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

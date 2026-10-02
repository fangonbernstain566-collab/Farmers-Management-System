import { one, rows, type DB } from "../db.js";
import { queueEmail } from "./email-queue.js";

type EmailEvent =
  | { type: "registration" }
  | { type: "complaint-submitted"; subject: string }
  | { type: "proof-submitted" };

/** One acknowledgement per farmer event and one message per active admin. */
export async function queueEventEmails(
  db: DB,
  farmerId: number,
  event: EmailEvent,
): Promise<void> {
  const farmer = await one<{ fullname: string }>(
    db,
    "SELECT fullname FROM users WHERE id=? AND role='farmer' AND is_deleted=false",
    [farmerId],
  );
  if (!farmer) return;
  let subject: string,
    message: string,
    adminSubject: string,
    adminMessage: string;
  switch (event.type) {
    case "registration":
      subject = "Welcome to Aringay Agriculture";
      message =
        "Your farmer account has been created successfully.\nSign in to complete your farm information and review your agriculture management workspace.";
      adminSubject = "New farmer registration";
      adminMessage = `A new farmer account has been created.\nFarmer: ${farmer.fullname}\nSign in and open the Farmer directory to review the registered information.`;
      break;
    case "complaint-submitted":
      subject = "Complaint submission received";
      message = `Your complaint has been submitted successfully.\nSubject: ${event.subject}\nSign in and open Complaints to review its status.`;
      adminSubject = "New farmer complaint";
      adminMessage = `A farmer submitted a new complaint.\nFarmer: ${farmer.fullname}\nSubject: ${event.subject}\nSign in and open Complaints to review it.`;
      break;
    case "proof-submitted":
      subject = "Proof of receipt submitted";
      message =
        "Your receipt confirmation and proof upload were recorded successfully.\nSign in and open Distribution history to review your receipt and uploaded proof.";
      adminSubject = "Farmer proof of receipt submitted";
      adminMessage = `A farmer confirmed receipt and submitted proof.\nFarmer: ${farmer.fullname}\nSign in and open Distribution history to review the proof securely.`;
      break;
  }
  await queueEmail(db, farmerId, subject, message);
  const admins = await rows<{ id: number }>(
    db,
    "SELECT id FROM users WHERE role='admin' AND is_deleted=false ORDER BY id",
  );
  for (const admin of admins)
    await queueEmail(db, admin.id, adminSubject, adminMessage);
}

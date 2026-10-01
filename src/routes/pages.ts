import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { one, rows, run, pool, transaction } from "../db.js";
import {
  authenticated,
  admin,
  farmer,
  ownership,
  flash,
  checkCsrf,
} from "../security.js";
import {
  id,
  farmerSchema,
  searchSchema,
  complaintSchema,
  resourceSchema,
  reasonSchema,
  tableSchema,
  batchSchema,
  activitySchema,
} from "../validation.js";
import { requireRecord, HttpError } from "../errors.js";
import type { User, Complaint, Distribution, Resource } from "../types.js";
import {
  complaints,
  getComplaint,
  createComplaint,
  editComplaint,
  deleteComplaint,
  confirmComplaint,
} from "../services/complaints.js";
import {
  history,
  distributeAll,
  deleteDocumentation,
  confirmReceipt,
  distributionSelect,
} from "../services/allocations.js";
import {
  getNotifications,
  unread,
  activitySql,
} from "../services/notifications.js";
import { trashItems, restore, permanentDelete } from "../services/trash.js";
import { upload, saveImage, removeImage, readImage } from "../uploads.js";
export const pages = Router();
pages.use(authenticated);
pages.use(async (req, res, next) => {
  res.locals.unread = await unread(req.user!);
  next();
});
const uploadLimit = rateLimit({
  windowMs: 60000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const mutationLimit = rateLimit({
  windowMs: 60000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
pages.use((req, res, next) =>
  req.method === "POST" ? mutationLimit(req, res, next) : next(),
);
pages.get("/dashboard", async (req, res) => {
  const user = req.user!;
  const isAdmin = user.role === "admin";
  const land = requireRecord(
    await one<{ farmers: number; hectares: string }>(
      pool,
      "SELECT COUNT(*) farmers,COALESCE(SUM(hectares),0) hectares FROM users WHERE role='farmer' AND is_deleted=false",
    ),
  );
  const resourceCount = requireRecord(
    await one<{ count: number }>(
      pool,
      "SELECT COUNT(*) count FROM resources WHERE is_deleted=false",
    ),
  );
  const dist = requireRecord(
    await one<{ records: number; pending: number; received: number }>(
      pool,
      "SELECT COUNT(*) records,COUNT(*) FILTER (WHERE status='pending') pending,COUNT(*) FILTER (WHERE status='received') received FROM distributions WHERE is_deleted=false" +
        (isAdmin ? "" : " AND farmer_id=?"),
      isAdmin ? [] : [user.id],
    ),
  );
  const chart = await rows<{
    distribution_date: string;
    total_quantity: string;
    distribution_count: number;
  }>(
    pool,
    "SELECT DATE(d.created_at) distribution_date,SUM(d.allocated_quantity) total_quantity,COUNT(*) distribution_count FROM distributions d JOIN users u ON d.farmer_id=u.id JOIN resources r ON d.resource_id=r.id WHERE d.is_deleted=false AND r.is_deleted=false" +
      (isAdmin ? " AND u.is_deleted=false" : " AND d.farmer_id=?") +
      " GROUP BY DATE(d.created_at) ORDER BY distribution_date",
    isAdmin ? [] : [user.id],
  );
  const documentation = await rows<Distribution>(
    pool,
    distributionSelect +
      " WHERE d.is_deleted=false AND u.is_deleted=false AND d.status='received' AND d.proof_image IS NOT NULL" +
      (isAdmin ? "" : " AND d.farmer_id=?") +
      " ORDER BY d.id DESC",
    isAdmin ? [] : [user.id],
  );
  res.render("dashboard", {
    title: "Dashboard",
    stats: {
      ...land,
      ...dist,
      resources: resourceCount.count,
      hectares: isAdmin ? land.hectares : user.hectares,
    },
    records: await history(user, true),
    chart,
    documentation,
  });
});
pages.get("/farmers", admin, async (req, res) => {
  const search = searchSchema.parse(req.query.search);
  const pattern = "%" + search + "%";
  const list = await rows<User>(
    pool,
    "SELECT * FROM users WHERE role='farmer' AND is_deleted=false AND (fullname LIKE ? OR contact_number LIKE ? OR address LIKE ? OR CAST(id AS TEXT) LIKE ?) ORDER BY address,fullname",
    [pattern, pattern, pattern, pattern],
  );
  let edit: User | undefined;
  if (req.query.edit)
    edit = requireRecord(
      await one<User>(
        pool,
        "SELECT * FROM users WHERE id=? AND role='farmer' AND is_deleted=false",
        [id.parse(req.query.edit)],
      ),
    );
  res.render("farmers", {
    title: "Farmers Management",
    farmers: list,
    search,
    edit,
  });
});
pages.post(
  "/farmers/:id/edit",
  admin,
  uploadLimit,
  upload.single("profile_pic"),
  checkCsrf,
  async (req, res) => {
    const farmerId = id.parse(req.params.id);
    const d = farmerSchema.parse(req.body);
    const photo = await saveImage(req.file);
    try {
      await transaction(async (db) => {
        requireRecord(
          await one<User>(
            db,
            "SELECT * FROM users WHERE id=? AND role='farmer' AND is_deleted=false FOR UPDATE",
            [farmerId],
          ),
        );
        await run(
          db,
          "UPDATE users SET fullname=?,hectares=?,birthdate=?,age=?,gender=?,civil_status=?,address=?,contact_number=?,place_of_birth=?" +
            (photo ? ",profile_pic=?" : "") +
            " WHERE id=?",
          [
            d.fullname,
            d.hectares,
            d.birthdate,
            d.age,
            d.gender,
            d.civil_status,
            d.address,
            d.contact_number,
            d.place_of_birth,
            ...(photo ? [photo] : []),
            farmerId,
          ],
        );
      });
    } catch (error) {
      await removeImage(photo);
      throw error;
    }
    flash(req, "Farmer information has been updated successfully.");
    res.redirect("/farmers");
  },
);
pages.post("/farmers/:id/delete", admin, async (req, res) => {
  const result = await run(
    pool,
    "UPDATE users SET is_deleted=true WHERE id=? AND role='farmer' AND is_deleted=false",
    [id.parse(req.params.id)],
  );
  if (!result.affectedRows) throw new HttpError(404, "Farmer not found.");
  flash(req, "Farmer moved to Trash.");
  res.redirect("/farmers");
});
pages.get("/profile", async (req, res) => {
  const user = req.user!;
  const farmerId = user.role === "admin" ? id.parse(req.query.id) : user.id;
  const profile = requireRecord(
    await one<User>(pool, "SELECT * FROM users WHERE id=? AND role='farmer'", [
      farmerId,
    ]),
  );
  ownership(user, profile.id);
  const allocations = await rows<Distribution>(
    pool,
    distributionSelect +
      " WHERE d.farmer_id=? AND d.is_deleted=false ORDER BY d.created_at DESC",
    [farmerId],
  );
  const logs = await rows<Complaint>(
    pool,
    "SELECT * FROM complaints WHERE farmer_id=? AND is_deleted=false ORDER BY created_at DESC",
    [farmerId],
  );
  res.render("profile", {
    title: "Farmer's Profile",
    profile,
    allocations,
    complaints: logs,
    viewHistory: user.role === "admin" && req.query.view_history === "1",
  });
});
pages.get("/resources", async (req, res) => {
  const resources = await rows<Resource>(
    pool,
    "SELECT * FROM resources WHERE is_deleted=false ORDER BY name",
  );
  const farmers =
    req.user!.role === "admin"
      ? await rows<User>(
          pool,
          "SELECT * FROM users WHERE role='farmer' AND is_deleted=false ORDER BY address,fullname",
        )
      : [];
  res.render("resources", { title: "Resource Management", resources, farmers });
});
pages.post("/resources", admin, async (req, res) => {
  const d = resourceSchema.parse(req.body);
  await run(
    pool,
    "INSERT INTO resources (name,total_quantity,unit) VALUES (?,?,?)",
    [d.name, d.total_quantity, d.unit],
  );
  flash(req, "Resource added successfully.");
  res.redirect("/resources");
});
pages.post("/resources/delete", admin, async (req, res) => {
  const input = req.body.selected_resources;
  const values = Array.isArray(input) ? input : [input];
  if (values.length > 1000)
    throw new HttpError(400, "Select at most 1000 resources.");
  const ids = values.map((v) => id.parse(v));
  await run(
    pool,
    `UPDATE resources SET is_deleted=true WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  flash(req, `${ids.length} resource item(s) removed from inventory.`);
  res.redirect("/resources");
});
pages.post("/resources/distribute", admin, async (req, res) => {
  const count = await distributeAll();
  flash(
    req,
    count
      ? "All available resources were distributed proportionally across active farmers based on farm size."
      : "There is no available resource stock to distribute.",
    count ? "success" : "warning",
  );
  res.redirect("/resources");
});
pages.get("/complaints", async (req, res) => {
  const edit = req.query.edit
    ? await getComplaint(req.user!, id.parse(req.query.edit))
    : null;
  res.render("complaints", {
    title: "Complaints",
    complaints: await complaints(req.user!),
    edit,
  });
});
pages.post(
  "/complaints",
  farmer,
  uploadLimit,
  upload.single("complaint_image"),
  checkCsrf,
  async (req, res) => {
    const d = complaintSchema.parse(req.body);
    const image = await saveImage(req.file, "complaints");
    try {
      await createComplaint(req.user!, d.subject, d.message, image);
    } catch (error) {
      await removeImage(image);
      throw error;
    }
    flash(req, "Your complaint has been submitted successfully.");
    res.redirect("/complaints");
  },
);
pages.post(
  "/complaints/:id/edit",
  uploadLimit,
  upload.single("complaint_image"),
  checkCsrf,
  async (req, res) => {
    const complaintId = id.parse(req.params.id);
    await getComplaint(req.user!, complaintId);
    const d = complaintSchema.parse(req.body);
    const image = await saveImage(req.file, "complaints");
    let old: string | null;
    try {
      old = await editComplaint(
        req.user!,
        complaintId,
        d.subject,
        d.message,
        image,
      );
    } catch (error) {
      await removeImage(image);
      throw error;
    }
    if (old) await removeImage(old);
    flash(req, "Your complaint has been updated successfully.");
    res.redirect("/complaints");
  },
);
pages.post("/complaints/:id/delete", async (req, res) => {
  await deleteComplaint(req.user!, id.parse(req.params.id));
  flash(req, "The complaint was moved to Trash.");
  res.redirect("/complaints");
});
pages.post("/complaints/:id/confirm", admin, async (req, res) => {
  await confirmComplaint(req.user!.id, id.parse(req.params.id));
  flash(req, "Complaint confirmed and the farmer was notified.");
  res.redirect("/complaints");
});
pages.get("/history", async (req, res) =>
  res.render("history", {
    title: "Distribution History",
    records: await history(req.user!),
  }),
);
pages.post("/distributions/:id/delete", admin, async (req, res) => {
  const d = reasonSchema.parse(req.body);
  await deleteDocumentation(
    id.parse(req.params.id),
    req.user!.id,
    d.deletion_reason,
  );
  flash(req, "Documentation deleted and the farmer was notified.");
  res.redirect("/history");
});
pages.get("/notifications", async (req, res) => {
  const user = req.user!;
  const pending = await rows<Distribution>(
    pool,
    distributionSelect +
      " WHERE d.is_deleted=false AND d.status='pending'" +
      (user.role === "admin" ? "" : " AND d.farmer_id=?") +
      " ORDER BY d.created_at DESC,d.id",
    user.role === "admin" ? [] : [user.id],
  );
  const groups = new Map<string, Distribution[]>();
  for (const d of pending) {
    const key = d.farmer_id + ":" + d.created_at;
    const group = groups.get(key) ?? [];
    group.push(d);
    groups.set(key, group);
  }
  res.render("notifications", {
    title:
      user.role === "admin"
        ? "Farmer Account Activity"
        : "Notifications & Receipts",
    notifications: await getNotifications(user),
    batches: Array.from(groups.values()),
  });
});
pages.post("/notifications/:id/read", farmer, async (req, res) => {
  const result = await run(
    pool,
    "UPDATE notifications SET is_read=true WHERE id=? AND farmer_id=?",
    [id.parse(req.params.id), req.user!.id],
  );
  if (!result.affectedRows) throw new HttpError(404, "Notification not found.");
  res.redirect("/notifications");
});
pages.post("/activities/read", admin, async (req, res) => {
  const key = activitySchema.parse(req.body.activity_key);
  const activity = await one(
    pool,
    `SELECT activity_key FROM (${activitySql}) a WHERE activity_key=?`,
    [key],
  );
  if (!activity) throw new HttpError(404, "Activity not found.");
  await run(
    pool,
    "INSERT INTO admin_notification_reads (admin_id,activity_key) VALUES (?,?) ON CONFLICT (admin_id,activity_key) DO NOTHING",
    [req.user!.id, key],
  );
  res.redirect("/notifications");
});
pages.post(
  "/receipts/confirm",
  farmer,
  uploadLimit,
  upload.single("proof"),
  checkCsrf,
  async (req, res) => {
    const batch = batchSchema.parse(req.body.batch_received_at);
    const proof = await saveImage(req.file);
    if (!proof) throw new HttpError(400, "Please select a valid proof image.");
    try {
      await confirmReceipt(req.user!.id, batch, proof);
    } catch (error) {
      await removeImage(proof);
      throw error;
    }
    flash(
      req,
      "Documentation confirmed successfully. Your proof image has been uploaded.",
    );
    res.redirect("/notifications");
  },
);
pages.get("/receipts/:id", async (req, res) => {
  const d = requireRecord(
    await one<Distribution>(
      pool,
      distributionSelect + " WHERE d.id=? AND d.is_deleted=false",
      [id.parse(req.params.id)],
    ),
  );
  ownership(req.user!, d.farmer_id);
  const records = await rows<Distribution>(
    pool,
    distributionSelect +
      " WHERE d.farmer_id=? AND d.created_at=? AND d.is_deleted=false ORDER BY r.name",
    [d.farmer_id, d.created_at],
  );
  res.render("receipt", {
    title: "Digital Distribution Receipt",
    records,
    receipt: d,
  });
});
pages.get("/trash", admin, async (_req, res) =>
  res.render("trash", { title: "Trash Bin", items: await trashItems() }),
);
pages.post("/trash/:table/:id/restore", admin, async (req, res) => {
  await restore(tableSchema.parse(req.params.table), id.parse(req.params.id));
  flash(req, "The item has been restored successfully.");
  res.redirect("/trash");
});
pages.post("/trash/:table/:id/delete", admin, async (req, res) => {
  await permanentDelete(
    tableSchema.parse(req.params.table),
    id.parse(req.params.id),
  );
  flash(req, "The item has been permanently deleted.");
  res.redirect("/trash");
});
pages.get("/images/:kind/:id", async (req, res) => {
  const recordId = id.parse(req.params.id);
  let value: string | null = null;
  if (req.params.kind === "complaint") {
    const c = requireRecord(
      await one<Complaint>(pool, "SELECT * FROM complaints WHERE id=?", [
        recordId,
      ]),
    );
    ownership(req.user!, c.farmer_id);
    if (c.is_deleted && req.user!.role !== "admin")
      throw new HttpError(404, "Image not found.");
    value = c.image_path;
  } else if (req.params.kind === "proof") {
    const d = requireRecord(
      await one<Distribution>(pool, "SELECT * FROM distributions WHERE id=?", [
        recordId,
      ]),
    );
    ownership(req.user!, d.farmer_id);
    if (d.is_deleted && req.user!.role !== "admin")
      throw new HttpError(404, "Image not found.");
    value = d.proof_image;
  } else if (req.params.kind === "profile") {
    const u = requireRecord(
      await one<User>(
        pool,
        "SELECT * FROM users WHERE id=? AND role='farmer'",
        [recordId],
      ),
    );
    ownership(req.user!, u.id);
    value = u.profile_pic;
  } else throw new HttpError(404, "Image not found.");
  if (!value || value === "default.png")
    throw new HttpError(404, "Image not found.");
  const image = await readImage(value);
  res
    .set({
      "Content-Type": image.type,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    })
    .send(image.data);
});

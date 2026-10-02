// Synthetic data for offline template/browser verification only.
export const farmerFixture = {
  id: 7,
  role: "farmer",
  fullname: "Maria Santos",
  email: "farmer@example.test",
  birthdate: "1988-04-12",
  age: 38,
  gender: "Female",
  civil_status: "Married",
  address: "Poblacion, Aringay, La Union",
  contact_number: "09123456789",
  place_of_birth: "Aringay",
  hectares: "3.50",
  profile_pic: "default.png",
  is_deleted: false,
};
export const adminFixture = {
  ...farmerFixture,
  id: 1,
  role: "admin",
  fullname: "Agriculture Administrator",
};
const distribution = {
  id: 21,
  farmer_id: 7,
  fullname: farmerFixture.fullname,
  resource_name: "Rice seeds",
  allocated_quantity: "25.5000",
  unit: "kg",
  status: "pending",
  created_at: "2026-09-28 09:30:00",
  proof_image: null,
  received_at: null,
};
const complaint = {
  id: 8,
  farmer_id: 7,
  fullname: farmerFixture.fullname,
  subject: "Resource collection schedule",
  message: "Please confirm the collection time for our allocated rice seeds.",
  status: "pending",
  image_path: "complaints/sample.png",
  created_at: "2026-09-29 10:00:00",
};
export interface FrontendScenario {
  name: string;
  page: string;
  locals: Record<string, unknown>;
}
export function frontendScenarios(): FrontendScenario[] {
  const scenarios: FrontendScenario[] = [];
  function add(
    name: string,
    page: string,
    user: typeof farmerFixture | null,
    data: Record<string, unknown> = {},
    route = "/" + page,
  ) {
    scenarios.push({
      name,
      page,
      locals: {
        title:
          page === "error"
            ? "Request could not be completed"
            : page.charAt(0).toUpperCase() + page.slice(1),
        path: route,
        user,
        csrf: "offline-verification-csrf-token",
        flash: null,
        unread: user ? 3 : 0,
        ...data,
      },
    });
  }
  for (const mode of ["login", "register", "hectares"]) {
    add(
      "auth-" + mode,
      "auth",
      mode === "hectares" ? farmerFixture : null,
      { mode },
      mode === "hectares" ? "/setup-hectares" : "/" + mode,
    );
  }
  add(
    "auth-login-signed-in",
    "auth",
    adminFixture,
    { mode: "login" },
    "/login",
  );
  for (const user of [adminFixture, farmerFixture]) {
    const role = user.role;
    for (const populated of [false, true]) {
      const suffix = role + (populated ? "-populated" : "-empty");
      const records = populated
        ? [
            distribution,
            {
              ...distribution,
              id: 22,
              status: "received",
              proof_image: "proof/sample.png",
              received_at: "2026-09-29 10:00:00",
            },
          ]
        : [];
      add("dashboard-" + suffix, "dashboard", user, {
        stats: {
          farmers: 128,
          hectares: "340.50",
          resources: 4,
          pending: 1,
          records: 2,
          received: 1,
        },
        chart: populated
          ? [
              {
                distribution_date: "2026-09-28",
                total_quantity: "50.00",
                distribution_count: 2,
              },
            ]
          : [],
        records,
        documentation: populated ? [records[1]] : [],
      });
      add("resources-" + suffix, "resources", user, {
        resources: populated
          ? [
              {
                id: 3,
                name: "Rice seeds",
                total_quantity: "250.0000",
                unit: "kg",
              },
              { id: 4, name: "Fertilizer", total_quantity: "0", unit: "bags" },
            ]
          : [],
        farmers: populated && role === "admin" ? [farmerFixture] : [],
      });
      add("complaints-" + suffix, "complaints", user, {
        complaints: populated
          ? [
              complaint,
              { ...complaint, id: 9, status: "confirmed", image_path: null },
            ]
          : [],
        edit: null,
      });
      add("notifications-" + suffix, "notifications", user, {
        notifications: populated
          ? [
              {
                id: 5,
                message: "Resources have been allocated to your farm.",
                detail: "Rice seeds distributed to Maria Santos.",
                is_read: false,
                created_at: distribution.created_at,
                activity_time: distribution.created_at,
                activity_key: "distribution:21",
              },
              {
                id: 6,
                message: "Your complaint has been confirmed.",
                detail: "Farmer complaint confirmed.",
                is_read: true,
                created_at: complaint.created_at,
                activity_time: complaint.created_at,
                activity_key: "complaint:8",
              },
            ]
          : [],
        batches: populated ? [[distribution]] : [],
      });
      add("history-" + suffix, "history", user, { records });
    }
    add("complaints-" + role + "-edit", "complaints", user, {
      complaints: [complaint],
      edit: complaint,
    });
    add("profile-" + role, "profile", user, {
      profile: farmerFixture,
      allocations: [distribution],
      complaints: [complaint],
      viewHistory: role === "admin",
    });
    add("profile-" + role + "-empty", "profile", user, {
      profile: { ...farmerFixture, profile_pic: "profile/sample.png" },
      allocations: [],
      complaints: [],
      viewHistory: role === "admin",
    });
    for (const received of [false, true]) {
      const receipt = received
        ? {
            ...distribution,
            status: "received",
            proof_image: "proof/sample.png",
            received_at: "2026-09-29 10:00:00",
          }
        : distribution;
      add(
        "receipt-" + role + (received ? "-received" : "-pending"),
        "receipt",
        user,
        { receipt, records: [receipt] },
        "/receipts/21",
      );
    }
    add("error-" + role, "error", user, {
      message: "Invalid form token. Reload the page and try again.",
    });
  }
  add("farmers-populated", "farmers", adminFixture, {
    farmers: [farmerFixture],
    edit: null,
    search: "",
  });
  add("farmers-edit", "farmers", adminFixture, {
    farmers: [farmerFixture],
    edit: farmerFixture,
    search: "",
  });
  add("farmers-empty", "farmers", adminFixture, {
    farmers: [],
    edit: null,
    search: "",
  });
  add("farmers-search", "farmers", adminFixture, {
    farmers: [],
    edit: null,
    search: "Not found",
  });
  add("trash-empty", "trash", adminFixture, {
    items: { users: [], resources: [], distributions: [], complaints: [] },
  });
  add("trash-populated", "trash", adminFixture, {
    items: Object.fromEntries(
      ["users", "resources", "distributions", "complaints"].map((table) => [
        table,
        [{ id: 7, label: "Deleted " + table }],
      ]),
    ),
  });
  add("error-anonymous", "error", null, {
    message: "Enter a valid birthdate.",
  });
  for (const type of ["success", "error", "warning", "info"]) {
    add(
      "flash-" + type,
      "auth",
      null,
      { mode: "login", flash: { type, message: "Verification message." } },
      "/login",
    );
  }
  return scenarios;
}

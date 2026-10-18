import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const file = path.resolve(process.argv[2] || "data/library.sqlite"),
  db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys=ON");
const rooms = db.prepare("SELECT state FROM presentation_rooms").all(),
  interactionTokens = rooms
    .map((row) => {
      try {
        return JSON.parse(row.state).interactionToken || "";
      } catch {
        return "";
      }
    })
    .filter(Boolean);
db.exec("BEGIN IMMEDIATE");
try {
  const removeAudience = db.prepare(
    "DELETE FROM audience_sessions WHERE token=?",
  );
  for (const token of interactionTokens) removeAudience.run(token);
  const removed = db.prepare("DELETE FROM presentation_rooms").run().changes;
  db.exec("COMMIT");
  console.log(
    JSON.stringify({
      database: file,
      roomsRemoved: Number(removed),
      interactionsRemoved: interactionTokens.length,
    }),
  );
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

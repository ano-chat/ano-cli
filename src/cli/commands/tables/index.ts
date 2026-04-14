import { Command } from "commander";
import { registerListTables } from "./list.js";
import { registerGetTable } from "./get.js";
import { registerQueryItems } from "./query.js";
import { registerCreateTable } from "./create.js";
import { registerCreateItem } from "./create-item.js";
import { registerUpdateItem } from "./update-item.js";
import { registerCommentItem } from "./comment.js";

export function registerTables(parent: Command): void {
  const group = new Command("tables").description(
    "List, query, and manage tables and items",
  );
  registerListTables(group);
  registerGetTable(group);
  registerQueryItems(group);
  registerCreateTable(group);
  registerCreateItem(group);
  registerUpdateItem(group);
  registerCommentItem(group);
  parent.addCommand(group);
}

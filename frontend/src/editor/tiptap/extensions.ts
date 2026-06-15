import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "tiptap-markdown";
import { SlashCommand } from "./SlashMenu";

/** Base extension set for the rich (Tiptap) editor. */
export function createExtensions() {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown.configure({
      html: false,
      tightLists: true,
      bulletListMarker: "-",
      linkify: false,
    }),
    Placeholder.configure({
      placeholder: "Start writing…",
    }),
    SlashCommand,
  ];
}

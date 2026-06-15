import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { createRoot, type Root } from "react-dom/client";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  SquareCode,
  type LucideIcon,
} from "lucide-react";
import { menuContentClass, menuItemClass } from "@/components/ui/menu";

interface SlashItem {
  title: string;
  description: string;
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
}

const SLASH_ITEMS: SlashItem[] = [
  {
    title: "Text",
    description: "Plain paragraph",
    icon: Pilcrow,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: Heading1,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: Heading2,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: Heading3,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: List,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: ListOrdered,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Task List",
    description: "Checklist with checkboxes",
    icon: ListChecks,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "Blockquote",
    description: "Quoted text",
    icon: Quote,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Code Block",
    description: "Fenced code block",
    icon: SquareCode,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: Minus,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

function SlashMenuList({
  items,
  selected,
  onSelect,
}: {
  items: SlashItem[];
  selected: number;
  onSelect: (item: SlashItem) => void;
}) {
  if (items.length === 0) {
    return <div className={menuContentClass}>No matches</div>;
  }
  return (
    <div className={menuContentClass}>
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <button
            key={item.title}
            type="button"
            className={menuItemClass}
            data-highlighted={index === selected ? "" : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
          >
            <Icon size={14} className="text-faint" />
            <span className="flex flex-col items-start">
              <span>{item.title}</span>
              <span className="text-xs text-faint">{item.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const suggestion: Omit<SuggestionOptions<SlashItem>, "editor"> = {
  char: "/",
  startOfLine: false,
  items: ({ query }) =>
    SLASH_ITEMS.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())).slice(
      0,
      10,
    ),
  command: ({ editor, range, props }) => props.run(editor, range),
  render: () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;
    let selected = 0;
    let currentItems: SlashItem[] = [];
    let currentCommand: ((item: SlashItem) => void) | null = null;

    const render = () => {
      if (!root) return;
      root.render(
        <SlashMenuList
          items={currentItems}
          selected={selected}
          onSelect={(item) => currentCommand?.(item)}
        />,
      );
    };

    const position = (clientRect?: (() => DOMRect | null) | null) => {
      if (!container) return;
      const rect = clientRect?.();
      if (!rect) return;
      container.style.left = `${rect.left + window.scrollX}px`;
      container.style.top = `${rect.bottom + window.scrollY + 4}px`;
    };

    return {
      onStart: (props) => {
        currentItems = props.items;
        currentCommand = props.command;
        selected = 0;
        container = document.createElement("div");
        container.style.position = "absolute";
        container.style.zIndex = "50";
        document.body.appendChild(container);
        root = createRoot(container);
        position(props.clientRect);
        render();
      },
      onUpdate: (props) => {
        currentItems = props.items;
        currentCommand = props.command;
        selected = Math.min(selected, Math.max(props.items.length - 1, 0));
        position(props.clientRect);
        render();
      },
      onKeyDown: (props) => {
        if (props.event.key === "ArrowDown") {
          selected = (selected + 1) % Math.max(currentItems.length, 1);
          render();
          return true;
        }
        if (props.event.key === "ArrowUp") {
          selected = (selected - 1 + Math.max(currentItems.length, 1)) % Math.max(
            currentItems.length,
            1,
          );
          render();
          return true;
        }
        if (props.event.key === "Enter") {
          const item = currentItems[selected];
          if (item) currentCommand?.(item);
          return true;
        }
        if (props.event.key === "Escape") {
          return true;
        }
        return false;
      },
      onExit: () => {
        root?.unmount();
        container?.remove();
        root = null;
        container = null;
      },
    };
  },
};

export const SlashCommand = Extension.create({
  name: "slash-command",

  addOptions() {
    return { suggestion };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

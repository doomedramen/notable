import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Italic, Link, Strikethrough } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      className={cn(active && "bg-surface-hover text-foreground")}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function BubbleToolbar({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      className="ui-popover flex items-center gap-0.5 rounded-md bg-background p-1 shadow-[var(--shadow-popover)]"
      shouldShow={({ state }) => !state.selection.empty}
    >
      <ToolbarButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="Bold"
      >
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="Italic"
      >
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        label="Strikethrough"
      >
        <Strikethrough size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
        label="Inline code"
      >
        <Code size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("link")}
        onClick={() => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const url = window.prompt("Link URL");
          if (!url) return;
          editor.chain().focus().setLink({ href: url }).run();
        }}
        label="Link"
      >
        <Link size={14} />
      </ToolbarButton>
    </BubbleMenu>
  );
}

# Editor Migration Plan: CodeMirror to Tiptap

## Context
Notable currently uses **CodeMirror 6** as its primary editor. While CodeMirror is excellent for plain-text Markdown editing and handles large files with high performance, our long-term vision is to provide a "Notion-like" experience that feels "digital-first."

## Why Tiptap?
To achieve a truly modern, block-based UI, we plan to migrate to **Tiptap** (built on ProseMirror).

### 1. Block-Based Architecture
Tiptap treats elements (paragraphs, code blocks, images, callouts) as distinct nodes. This makes it much easier to implement:
- Drag-and-drop block reordering.
- Slash commands (`/`) for inserting complex elements.
- "Hovering" menus specific to block types.
- Side-aligned "plus" and "drag" handles.

### 2. Richer Rendering
Instead of using CSS hacks to make text *look* like a block (as we do in CodeMirror), Tiptap allows us to render actual React components for specific nodes. A code block can be a full-featured component with a language selector, copy button, and dedicated UI chrome.

### 3. Collaboration (Yjs)
While we currently use Yjs with CodeMirror, Tiptap's document model is more structured (JSON-based). This provides a more robust foundation for resolving conflicts in complex structures like tables or nested layouts.

## Migration Strategy
The migration will be phased to ensure stability:

1.  **Phase 1: Hybrid State (Current)**
    - Improve CodeMirror's "Live Preview" to mimic block-style rendering.
    - Solidify the Yjs sync logic between the editor and the file system.
2.  **Phase 2: Tiptap Prototype**
    - Implement a parallel editor view using Tiptap.
    - Develop a "Markdown-to-JSON" and "JSON-to-Markdown" serializer to maintain compatibility with `.md` files in the vault.
3.  **Phase 3: Plugin API V2**
    - Bridge the existing CodeMirror-based plugin API to support Tiptap nodes.
    - Provide migration paths for plugin authors.
4.  **Phase 4: Full Cutover**
    - Switch the default editor to Tiptap.
    - Keep CodeMirror as an "Advanced/Source Mode" option for power users.

## Challenges to Address
- **Serialization:** Ensuring that Tiptap's JSON model doesn't "mangle" the user's preferred Markdown formatting when saving back to the file system.
- **Performance:** Optimizing Tiptap for very large documents where CodeMirror currently excels.
- **Plugin Compatibility:** Providing a way for existing plugins to interact with the new node-based system.

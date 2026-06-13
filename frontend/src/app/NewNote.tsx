import { useEffect } from "react";
import { Navigate } from "react-router";
import { useUI } from "../store/ui";

/** Target of the installed app's "New note" shortcut: creates a note and
    redirects straight into it. */
export function NewNote() {
  useEffect(() => {
    useUI.getState().openQuickNote();
  }, []);

  return <Navigate to="/" replace />;
}

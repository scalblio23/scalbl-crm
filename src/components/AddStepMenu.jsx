import React, { useState } from "react";
import { Plus, Send, MessageSquare, Clock } from "lucide-react";

// A small "+" button between automation steps (and one before the
// first step) that opens a type picker — Email / SMS / Wait — for
// inserting a new step at that exact position, rather than only ever
// being able to append to the end of the chain.
export default function AddStepMenu({ onAdd }) {
  const [open, setOpen] = useState(false);

  function add(action) {
    onAdd(action);
    setOpen(false);
  }

  return (
    <div className="relative flex justify-center py-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-6 h-6 rounded-full border border-gray-200 bg-white text-gray-400 hover:text-gray-700 hover:border-gray-400 flex items-center justify-center"
      >
        <Plus size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-48">
            <button
              onClick={() => add({ type: "email", subject: "", body: "" })}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50"
            >
              <Send size={13} /> Send Email
            </button>
            <button
              onClick={() => add({ type: "sms", subject: "", body: "" })}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50"
            >
              <MessageSquare size={13} /> Send SMS
            </button>
            <button
              onClick={() => add({ type: "wait", mode: "duration", amount: 1, unit: "hours" })}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50"
            >
              <Clock size={13} /> Wait
            </button>
          </div>
        </>
      )}
    </div>
  );
}

import * as React from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onVisitReport: () => void;
  onPdfReport: () => void;
  onJsonExport: () => void;
  onCsvExport: () => void;
  onDeleteAll?: () => void;
};

export default function ShareExportSheet({
  open, onClose, onVisitReport, onPdfReport, onJsonExport, onCsvExport, onDeleteAll,
}: Props) {
  if (!open) return null;
  
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto max-w-screen-sm rounded-t-2xl bg-white p-4
                   shadow-xl animate-in slide-in-from-bottom duration-200"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        role="dialog" 
        aria-modal="true" 
        aria-label="Share & Export"
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-gray-300 mb-4" />
        <h3 className="text-lg font-semibold mb-1">Share & Export</h3>
        
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-gray-700">Clinical Reports</h4>
          <p className="text-sm text-gray-500 mb-2">For healthcare providers</p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button 
              className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium hover:bg-gray-50 active:scale-95" 
              onClick={() => { 
                onVisitReport(); 
                setTimeout(onClose, 100); // Small delay to ensure PDF generation starts
              }}
            >
              Visit Summary
            </button>
            <button 
              className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium hover:bg-gray-50 active:scale-95" 
              onClick={() => { onPdfReport(); onClose(); }}
            >
              Full Report
            </button>
          </div>
        </div>

        <div className="mt-4">
          <h4 className="text-sm font-semibold text-gray-700">Data Export</h4>
          <p className="text-sm text-gray-500 mb-2">Backup your data</p>
          <div className="grid grid-cols-2 gap-2">
            <button 
              className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium hover:bg-gray-50 active:scale-95" 
              onClick={() => { onJsonExport(); onClose(); }}
            >
              JSON
            </button>
            <button 
              className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium hover:bg-gray-50 active:scale-95" 
              onClick={() => { onCsvExport(); onClose(); }}
            >
              CSV
            </button>
          </div>
        </div>

        {onDeleteAll && (
          <button
            className="w-full mt-6 rounded-xl border border-red-300 text-red-700 px-4 py-3 text-sm font-medium hover:bg-red-50 active:scale-95"
            onClick={() => { 
              if(confirm('Delete all data? This cannot be undone.')) {
                onDeleteAll(); 
                onClose();
              }
            }}
          >
            Delete All Data
          </button>
        )}

        <button 
          className="mt-4 w-full rounded-xl bg-gray-100 py-3 font-medium hover:bg-gray-200 active:scale-95" 
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
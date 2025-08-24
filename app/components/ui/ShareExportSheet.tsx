import * as React from "react";
import { createPortal } from "react-dom";
import { useReportGenerator } from '../ReportGenerator';

type Props = {
  open: boolean;
  onClose: () => void;
  onVisitReport?: () => void;
  onPdfReport?: () => void;
  onJsonExport: () => void;
  onCsvExport: () => void;
  onDeleteAll?: () => void;
};

export default function ShareExportSheet({
  open, onClose, onJsonExport, onCsvExport, onDeleteAll,
}: Props) {
  const [isGenerating, setIsGenerating] = React.useState<string | null>(null);
  const [isMounted, setIsMounted] = React.useState(false);
  const { generateVisitSummary, generateFullReport } = useReportGenerator();

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  React.useEffect(() => {
    if (open && isMounted) {
      document.body.style.overflow = 'hidden';
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.body.style.overflow = '';
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [open, onClose, isMounted]);

  const handleVisitReport = async () => {
    setIsGenerating('visit');
    try {
      await generateVisitSummary();
      setIsGenerating(null);
      onClose(); // Close modal after successful generation
    } catch (error) {
      setIsGenerating(null);
      console.error('Visit report failed:', error);
    }
  };

  const handlePdfReport = async () => {
    setIsGenerating('pdf');
    try {
      await generateFullReport();
      setIsGenerating(null);
      onClose(); // Close modal after successful generation
    } catch (error) {
      setIsGenerating(null);
      console.error('PDF report failed:', error);
    }
  };

  const handleJsonExport = async () => {
    setIsGenerating('json');
    try {
      await onJsonExport();
      setIsGenerating(null);
    } catch (error) {
      setIsGenerating(null);
      console.error('JSON export failed:', error);
    }
  };

  const handleCsvExport = async () => {
    setIsGenerating('csv');
    try {
      await onCsvExport();
      setIsGenerating(null);
    } catch (error) {
      setIsGenerating(null);
      console.error('CSV export failed:', error);
    }
  };

  if (!isMounted || !open) return null;
  
  const modalContent = (
    <div 
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-t-2xl w-full max-w-md max-h-[80vh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom duration-300"
        style={{ 
          paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
        }}
        role="dialog" 
        aria-modal="true" 
        aria-label="Share & Export"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full" />
        </div>
        
        <div className="px-6 pb-6">
          <h3 className="text-lg font-semibold mb-1 text-gray-900 dark:text-white">Share & Export</h3>
          
          {/* Clinical Reports */}
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Clinical Reports</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Perfect for doctor visits</p>
            <div className="space-y-3">
              <button 
                className={`w-full rounded-xl border px-4 py-4 text-sm font-medium transition-all text-left ${
                  isGenerating === 'visit' 
                    ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                    : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-white'
                }`}
                onClick={handleVisitReport}
                disabled={isGenerating !== null}
              >
                {isGenerating === 'visit' ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                    <span>Generating Visit Summary...</span>
                  </div>
                ) : (
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white">📋 Visit Summary PDF</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Last 30 days overview for your doctor</div>
                  </div>
                )}
              </button>
              
              <button 
                className={`w-full rounded-xl border px-4 py-4 text-sm font-medium transition-all text-left ${
                  isGenerating === 'pdf' 
                    ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                    : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-white'
                }`}
                onClick={handlePdfReport}
                disabled={isGenerating !== null}
              >
                {isGenerating === 'pdf' ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                    <span>Generating Full Report...</span>
                  </div>
                ) : (
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white">📊 Full Report PDF</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Complete analysis with all data</div>
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* Data Export */}
          <div className="mt-6">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Data Export</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Backup and share your data</p>
            <div className="grid grid-cols-2 gap-3">
              <button 
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition-all ${
                  isGenerating === 'json' 
                    ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                    : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-white'
                }`}
                onClick={handleJsonExport}
                disabled={isGenerating !== null}
              >
                {isGenerating === 'json' ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-3 h-3 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-xs">Exporting...</span>
                  </div>
                ) : (
                  <>
                    <div className="font-semibold text-gray-900 dark:text-white">💾 JSON</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Complete backup</div>
                  </>
                )}
              </button>
              
              <button 
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition-all ${
                  isGenerating === 'csv' 
                    ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                    : 'border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-white'
                }`}
                onClick={handleCsvExport}
                disabled={isGenerating !== null}
              >
                {isGenerating === 'csv' ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-3 h-3 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-xs">Exporting...</span>
                  </div>
                ) : (
                  <>
                    <div className="font-semibold text-gray-900 dark:text-white">📈 CSV</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">For Excel/Sheets</div>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Delete All Data */}
          {onDeleteAll && (
            <button
              className="w-full mt-6 rounded-xl border border-red-600 dark:border-red-500 bg-red-900/10 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-4 py-3 text-sm font-medium hover:bg-red-900/20 dark:hover:bg-red-900/30 transition-all"
              onClick={() => { 
                if (window.confirm('⚠️ DELETE ALL DATA?\n\nThis will permanently delete:\n• All symptoms\n• All medications\n• All settings\n\nThis cannot be undone. Are you sure?')) {
                  if (window.confirm('Final confirmation: Delete all your health data?\n\nThis action is PERMANENT and cannot be reversed.')) {
                    onDeleteAll(); 
                    onClose();
                  }
                }
              }}
            >
              🗑️ Delete All Data
            </button>
          )}

          {/* Cancel Button */}
          <button 
            className="mt-4 w-full rounded-xl bg-gray-100 dark:bg-gray-800 py-3 font-medium hover:bg-gray-200 dark:hover:bg-gray-700 dark:text-white transition-all" 
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
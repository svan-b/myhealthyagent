'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

export function DeleteDataButton() {
  const [open, setOpen] = useState(false);

  const handleDelete = async () => {
    try {
      // Clear IndexedDB
      const databases = await indexedDB.databases();
      for (const db of databases) {
        if (db.name) {
          await indexedDB.deleteDatabase(db.name);
        }
      }
      
      // Clear localStorage
      localStorage.clear();
      sessionStorage.clear();
      
      toast.success('All data deleted successfully');
      
      // Reload the page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Error deleting data:', error);
      toast.error('Failed to delete all data');
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="h-4 w-4 mr-2" />
          Delete All Data
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete All Data?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete all your symptoms, medications, and preferences from this device. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete}>
            Delete Everything
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { create } from "zustand";
import { supabase, Announcement, type User as SupabaseUser } from "./supabase";

type User = SupabaseUser;

/**
 * Why the signed-in Clerk account is not authorized for the portal.
 * "pending": no profile yet, waiting on an admin. "denied": an admin declined.
 * "disaffiliated": an admin marked the member as dropped/disaffiliated.
 * "pnm": a rush candidate's account, which belongs in /rush/portal.
 * "error": the server could not resolve the account.
 */
export type AuthStatus =
  | "pending"
  | "denied"
  | "disaffiliated"
  | "pnm"
  | "error"
  | null;

interface AuthState {
  user: User | null;
  isAuthorized: boolean;
  isLoading: boolean;
  authError: string | null;
  authStatus: AuthStatus;
  permissions: string[];
  announcements: Announcement[];
  isAnnouncementsLoading: boolean;
  setUser: (user: User | null) => void;
  setAuthorized: (authorized: boolean) => void;
  setLoading: (loading: boolean) => void;
  setAuthError: (error: string | null, status?: AuthStatus) => void;
  /** Merge a fresh copy of the signed-in member's profile into the store. */
  updateUser: (patch: Partial<User>) => void;
  setPermissions: (permissions: string[]) => void;
  setAnnouncements: (announcements: Announcement[]) => void;
  setAnnouncementsLoading: (loading: boolean) => void;
  fetchAnnouncements: () => Promise<void>;
  hideAnnouncement: (id: string) => Promise<void>;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthorized: false,
  isLoading: true,
  authError: null,
  authStatus: null,
  permissions: [],
  announcements: [],
  isAnnouncementsLoading: true,
  setUser: (user) => set({ user }),
  setAuthorized: (isAuthorized) => set({ isAuthorized }),
  setLoading: (isLoading) => set({ isLoading }),
  setAuthError: (authError, authStatus = authError ? "error" : null) =>
    set({ authError, authStatus }),
  updateUser: (patch) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...patch } : state.user,
    })),
  setPermissions: (permissions) => set({ permissions }),
  setAnnouncements: (announcements) => set({ announcements }),
  setAnnouncementsLoading: (isAnnouncementsLoading) =>
    set({ isAnnouncementsLoading }),
  reset: () =>
    set({
      user: null,
      isAuthorized: false,
      isLoading: false,
      authError: null,
      authStatus: null,
      permissions: [],
      announcements: [],
      isAnnouncementsLoading: false,
    }),

  fetchAnnouncements: async () => {
    try {
      set({ isAnnouncementsLoading: true });

      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .eq("hidden", false) // Only fetch non-hidden announcements
        .order("created_at", { ascending: false });

      if (error) throw error;

      set({ announcements: data || [] });
    } catch (err) {
      console.error("Error fetching announcements:", err);
      set({ announcements: [] });
    } finally {
      set({ isAnnouncementsLoading: false });
    }
  },

  hideAnnouncement: async (id: string) => {
    try {
      const { error } = await supabase
        .from("announcements")
        .update({ hidden: true })
        .eq("id", id);

      if (error) {
        console.error("Database error hiding announcement:", error);
        throw error;
      }

      // Remove from local state immediately
      const { announcements } = get();
      const updatedAnnouncements = announcements.filter((ann) => ann.id !== id);
      set({ announcements: updatedAnnouncements });
    } catch (err) {
      console.error("Error hiding announcement:", err);
      throw err;
    }
  },
}));

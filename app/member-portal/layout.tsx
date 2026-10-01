"use client";

import React from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { MemberPortalSidebar } from "@/components/member-portal/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarTrigger, SidebarProvider } from "@/components/ui/sidebar";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/ui/sonner";

type Props = {
  children: React.ReactNode;
};

export default function MemberPortalLayout({ children }: Props) {
  return (
    <ProtectedRoute>
      <QueryProvider>
      <SidebarProvider>
        <MemberPortalSidebar />
        <div className="flex flex-col w-full h-screen bg-muted/30">
          {/* Header with sidebar toggle */}
          <div className="bg-transparent px-4 md:px-6 py-4 pt-4 md:pt-4 pb-2 md:pb-3 border-b">
            <div className="flex items-center justify-between">
              <SidebarTrigger />
              <div className="flex items-center space-x-4">
                <ThemeToggle />
              </div>
            </div>
          </div>

          <main className="flex-1 overflow-y-auto px-4 md:px-6 pt-2 md:pt-3 pb-4 md:pb-6">
            {children}
          </main>
        </div>
        <Toaster richColors />
      </SidebarProvider>
      </QueryProvider>
    </ProtectedRoute>
  );
}

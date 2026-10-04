"use client";

import React from "react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { useTheme } from "next-themes";
import { SignOutButton } from "@clerk/nextjs";
import {
  Calendar,
  Megaphone,
  CreditCard,
  Landmark,
  Home,
  FileText,
  ChevronUp,
  Shield,
  KeyRound,
  Flame,
  UserRound,
  CalendarRange,
  ClipboardPen,
  Gavel,
  Contact,
  CalendarCog,
  Settings2,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { prefetchRushPage, useCycleParam } from "@/components/member-portal/rush/shared";
import { LiveIndicator } from "@/components/rush/live-indicator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuthStore } from "@/lib/auth-store";
import Link from "next/link";
import {
  canManageRush,
  canManageRushForms,
  canViewAdmin,
  canViewFinanceAdmin,
  canViewRush,
} from "@/lib/permissions";

export function MemberPortalSidebar() {
  //   const [isCollapsed, setIsCollapsed] = useState(false);
  //   const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { theme } = useTheme();
  const pathname = usePathname();
  const { user, permissions } = useAuthStore();

  const { open, setOpenMobile, isMobile } = useSidebar();

  // Close mobile sidebar when route changes.
  useEffect(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, pathname, setOpenMobile]);

  // const canPostAnnouncements = user?.role === 'admin' || user?.role === 'exec' || user?.role === 'director'

  const navigationItems = [
    { icon: Home, label: "Dashboard", href: "/member-portal" },
    { icon: Calendar, label: "Calendar", href: "/member-portal/calendar" },
    // {
    //   icon: Briefcase,
    //   label: "Internships",
    //   href: "/member-portal/internships",
    // },
    {
      icon: Megaphone,
      label: "Announcements",
      href: "/member-portal/announcements",
    },
    // { icon: Users, label: "Alumni Directory", href: "/member-portal/alumni" },
    // { icon: ShoppingBag, label: "Merch Store", href: "/member-portal/merch" },
    {
      icon: CreditCard,
      label: "Finance Portal",
      href: "/member-portal/finances",
    },
    // { icon: Vote, label: "Elections", href: "/member-portal/elections" },
    { icon: FileText, label: "Forms", href: "/member-portal/forms" },
  ];

  const externalLinks = [
    {
      icon: Flame,
      label: "Flare",
      href: "https://www.theflareapp.com/",
      external: true,
    },
  ];

  const coreAdminItems = [
    {
      icon: Shield,
      label: "Users",
      href: "/member-portal/admin/users",
    },
    {
      icon: KeyRound,
      label: "Roles and Permissions",
      href: "/member-portal/admin/roles",
    },
  ];

  const financeAdminItems = [
    {
      icon: Landmark,
      label: "Finance Management",
      href: "/member-portal/admin/finance",
    },
  ];

  const logoSrc =
    open && theme === "dark"
      ? "/ktp-logos/KTP Logo Dark Plain No BG Slim.png"
      : "/ktp-logos/KTP Logo Plain Text Slim.png";

  // Use dark sidebar for both themes - exact same styling

  // Check if current path matches navigation item
  const isActiveRoute = (href: string) => {
    if (href === "/member-portal") {
      return pathname === "/member-portal";
    }
    return pathname.startsWith(href);
  };

  const queryClient = useQueryClient();
  const cycleParam = useCycleParam();
  const rushView = canViewRush(permissions);
  const rushManage = canManageRush(permissions);
  const rushNav = useQuery({
    queryKey: ["rush", "nav"],
    queryFn: async () => {
      const response = await fetch("/api/rush/nav", { cache: "no-store" });
      if (!response.ok) return { deliberationLive: false, unmatchedPending: 0, cyclePhase: null };
      return (await response.json()) as {
        deliberationLive: boolean;
        unmatchedPending: number;
        cyclePhase: "open" | "closed" | "concluded" | null;
      };
    },
    refetchInterval: 60_000,
  });
  // Once the cycle has concluded, only people who run rush keep the tabs.
  const showRushGroup =
    rushNav.data?.cyclePhase !== "concluded" || canManageRushForms(permissions);
  const rushItems = [
    { icon: CalendarRange, label: "Schedule", href: "/member-portal/rush/schedule" },
    { icon: ClipboardPen, label: "PNM Forms", href: "/member-portal/rush/forms" },
    {
      icon: Gavel,
      label: "Deliberation",
      href: "/member-portal/rush/deliberation",
      live: Boolean(rushNav.data?.deliberationLive),
    },
    ...(rushView ? [{ icon: Contact, label: "PNMs", href: "/member-portal/rush/pnms" }] : []),
    ...(rushManage
      ? [
          {
            icon: CalendarCog,
            label: "Events & Check-in",
            href: "/member-portal/rush/events",
            badge: rushNav.data?.unmatchedPending ? String(rushNav.data.unmatchedPending) : null,
          },
          { icon: Settings2, label: "Rush Settings", href: "/member-portal/rush/settings" },
        ]
      : []),
  ];

  const canViewFinance = canViewFinanceAdmin(permissions);
  const canViewCoreAdmin = canViewAdmin(permissions);
  const showAdminGroup = canViewCoreAdmin || canViewFinance;
  const adminItems = [
    ...(canViewCoreAdmin ? coreAdminItems : []),
    ...(canViewFinance ? financeAdminItems : []),
  ];

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="flex items-center justify-center relative my-2">
        <Image src={logoSrc} alt={""} width={100} height={100} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActiveRoute(item.href)}
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {showRushGroup ? (
        <SidebarGroup>
          <SidebarGroupLabel>Rush</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {rushItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton asChild isActive={isActiveRoute(item.href)}>
                    <Link
                      href={item.href}
                      onMouseEnter={() => prefetchRushPage(queryClient, item.href, cycleParam)}
                      onFocus={() => prefetchRushPage(queryClient, item.href, cycleParam)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {"live" in item && item.live ? (
                    <SidebarMenuBadge>
                      <LiveIndicator />
                    </SidebarMenuBadge>
                  ) : "badge" in item && item.badge ? (
                    <SidebarMenuBadge className="bg-amber-500 text-white peer-hover/menu-button:text-white peer-data-[active=true]/menu-button:text-white">
                      {item.badge}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        ) : null}
        {showAdminGroup && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActiveRoute(item.href)}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup>
          <SidebarGroupLabel>External Links</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {externalLinks.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton asChild>
                    <Link href={item.href} prefetch={false} target="_blank">
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild className="h-full">
                <SidebarMenuButton>
                  <Avatar className="w-10 h-10 rounded-lg">
                    <AvatarImage src={user?.avatar} />
                    <AvatarFallback className="w-10 h-10 rounded-lg">
                      {user
                        ? user.name.charAt(0) +
                          (user.name.split(" ")[1]?.charAt(0) ?? "")
                        : ""}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex flex-col">
                    <div className="font-bold">{user?.name}</div>
                    <div>
                      {user?.role
                        ? user.role.charAt(0).toUpperCase() +
                          user.role.slice(1).toLowerCase()
                        : ""}
                    </div>
                  </div>

                  <ChevronUp className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                className="w-(--radix-dropdown-menu-trigger-width)"
              >
                <DropdownMenuItem asChild>
                  <Link href="/member-portal/profile">
                    <UserRound />
                    My Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <SignOutButton>
                  <DropdownMenuItem>
                    <span className="font-bold text-red-500">Sign out</span>
                  </DropdownMenuItem>
                </SignOutButton>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

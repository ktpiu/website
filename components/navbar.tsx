"use client";

import React, { useState, useEffect } from "react";
import { Menu, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useTheme } from "next-themes";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/members", label: "Members" },
  //   { href: "/rush", label: "Rush" },
  //   { href: "/docs", label: "Docs" },
];

const HOME_PAGE = "/";

interface NavbarProps {
  onScrollToSection?: (sectionId: string) => void;
}

export function Navbar({}: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close mobile menu when route changes
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const handleLogoClick = () => {
    if (pathname === HOME_PAGE) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      router.push(HOME_PAGE);
    }
  };

  const logoSrc =
    mounted && theme === "dark"
      ? "/ktp-logos/KTP Logo Dark Plain No BG.png"
      : "/ktp-logos/KTP Logo Plain Text.png";

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background select-none">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-center relative">
          {/* Logo - Absolute left */}
          <button
            onClick={handleLogoClick}
            className="absolute left-0 flex items-center"
            aria-label="KTP Home"
          >
            {mounted && (
              <Image
                src={logoSrc}
                alt="KTP Logo"
                width={120}
                height={60}
                className="h-12 w-auto object-contain"
                priority
              />
            )}
          </button>

          {/* Desktop Navigation - Center */}
          <NavigationMenu className="hidden lg:flex">
            <NavigationMenuList>
              {navItems.map((item) => (
                <NavigationMenuItem key={item.href}>
                  <NavigationMenuLink
                    asChild
                    className={navigationMenuTriggerStyle()}
                  >
                    <Link href={item.href}>{item.label}</Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>

          {/* Right side - Actions - Absolute right */}
          <div className="absolute right-0 flex items-center gap-2">
            {/* Member Portal Button - Desktop only */}
            <Button
              asChild
              variant="outline"
              size="sm"
              className="hidden md:inline-flex"
            >
              <Link href="/member-portal">
                <Users className="h-4 w-4 mr-2" />
                Member Portal
              </Link>
            </Button>

            <ThemeToggle />

            {/* Mobile Menu */}
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
              <SheetTrigger asChild className="lg:hidden">
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle navigation menu</span>
                </Button>
              </SheetTrigger>
              <SheetTitle />
              <SheetContent side="right" className="w-70 sm:w-87.5">
                <div className="flex flex-col h-full">
                  {/* Header with logo */}
                  <div className="flex justify-center py-6 h-40 border-b">
                    <button
                      onClick={() => {
                        handleLogoClick();
                        setIsOpen(false);
                      }}
                      className="flex items-center"
                      aria-label="KTP Home"
                    >
                      {mounted && (
                        <Image
                          src={logoSrc}
                          alt="KTP Logo"
                          width={400}
                          height={400}
                          className="h-40 w-auto object-contain"
                        />
                      )}
                    </button>
                  </div>

                  {/* Navigation items */}
                  <nav className="flex-1 py-6 mx-2">
                    <div className="space-y-2">
                      {navItems.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setIsOpen(false)}
                          className="block px-4 py-3 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  </nav>

                  {/* Bottom section with member portal button */}
                  <div className="border-t pt-6 pb-6 mx-2">
                    <Button
                      asChild
                      variant="outline"
                      size="lg"
                      className="w-full"
                    >
                      <Link
                        href="/member-portal"
                        onClick={() => setIsOpen(false)}
                      >
                        <Users className="h-4 w-4 mr-2" />
                        Member Portal
                      </Link>
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}

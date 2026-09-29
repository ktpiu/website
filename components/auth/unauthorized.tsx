import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, Clock, Mail, LogIn, ShieldX } from 'lucide-react'
import Link from 'next/link'
import { SignOutButton } from '@clerk/nextjs'
import type { AuthStatus } from '@/lib/auth-store'

interface UnauthorizedProps {
  message?: string | null
  status?: AuthStatus
}

const COPY = {
  pending: {
    Icon: Clock,
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    title: 'Approval Pending',
    description: 'Your account has been created and is waiting for an administrator to approve it.',
    body: "You'll be able to use the member portal as soon as an executive board member approves your account. This usually happens within a day or two. Check back later, or reach out if it's urgent.",
  },
  denied: {
    Icon: ShieldX,
    tone: 'bg-destructive/10 text-destructive',
    title: 'Access Not Approved',
    description: 'An administrator has declined portal access for this account.',
    body: 'The member portal is only available to current KTP members and alumni. If you believe this was a mistake, contact an administrator or try signing in with a different account.',
  },
  disaffiliated: {
    Icon: ShieldX,
    tone: 'bg-destructive/10 text-destructive',
    title: 'Access Removed',
    description: 'This account is no longer affiliated with KTP.',
    body: 'The member portal is only available to current KTP members and alumni. If you believe this was a mistake, contact an administrator.',
  },
  error: {
    Icon: AlertTriangle,
    tone: 'bg-destructive/10 text-destructive',
    title: 'Account Setup Needed',
    description: 'We could not finish loading your KTP member portal profile.',
    body: null,
  },
  restricted: {
    Icon: AlertTriangle,
    tone: 'bg-destructive/10 text-destructive',
    title: 'Access Restricted',
    description: 'Your email address is not authorized to access the KTP member portal.',
    body: 'Only current KTP members and alumni can access this portal. If you believe this is an error, please contact an administrator or try a different account.',
  },
} as const

export function Unauthorized({ message, status }: UnauthorizedProps) {
  const variant =
    status === 'pending' || status === 'denied' || status === 'disaffiliated'
      ? status
      : message
        ? 'error'
        : 'restricted'
  const copy = COPY[variant]
  const Icon = copy.Icon

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Card className="max-w-md mx-auto w-full">
        <CardHeader className="text-center">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${copy.tone}`}
          >
            <Icon className="w-8 h-8" />
          </div>
          <CardTitle className="text-2xl">{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            {copy.body ?? message}
          </p>
          <div className="space-y-2">
            <SignOutButton>
              <Button variant="outline" className="w-full">
                <LogIn className="w-4 h-4 mr-2" />
                {variant === 'pending' ? 'Sign Out' : 'Try Different Account'}
              </Button>
            </SignOutButton>
            <Button asChild className="w-full">
              <a href="mailto:ktpindiana@gmail.com">
                <Mail className="w-4 h-4 mr-2" />
                Contact Admin
              </a>
            </Button>
            <Button variant="outline" asChild className="w-full">
              <Link href="/">
                Return to Homepage
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

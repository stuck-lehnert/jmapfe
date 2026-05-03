import {
  EMPTY_ACCOUNT_SETUP_DRAFT,
  accountLoginUsername,
  createConfiguredAccount,
  type AccountAuthKind,
  type AccountSetupDraft,
  type ConfiguredAccount,
} from "@jmapfe/app-core"
import {
  CAP_MAIL,
  FetchJmapTransport,
  JmapDiscoveryError,
  JmapTransportError,
  discoveryCandidates,
  discoverJmapSessionWithUrl,
  parseJmapSession,
  resolveJmapSrvOverHttps,
  type AuthProvider,
  type JmapSession,
  type SrvRecord,
} from "@jmapfe/jmap-core"
import { useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { styles } from "../../styles"
import { Ui } from "../primitives"

const { PrimaryButton, SecondaryButton } = Ui

type SetupStep = "identity" | "server" | "auth" | "review"
type ServerStatus = "idle" | "checking" | "srv" | "fallback" | "error"
type CredentialStatus = "idle" | "checking" | "ok" | "error"

const DISCOVERY_ONLY_AUTH: AuthProvider = { kind: "bearer", token: "" }
const AUTH_OPTIONS: readonly { readonly value: AccountAuthKind; readonly label: string; readonly help: string }[] = [
  { value: "bearer", label: "API token", help: "Best for providers such as Fastmail app passwords or API tokens." },
  { value: "basic", label: "Password", help: "Only use when the server requires Basic Auth." },
]

export function AccountSetupFlow({ mode, onAccountVerified, fetchImpl }: {
  readonly mode: "first-run" | "settings"
  readonly onAccountVerified: (account: ConfiguredAccount, auth: AuthProvider) => void
  readonly fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}) {
  const [draft, setDraft] = useState<AccountSetupDraft>(EMPTY_ACCOUNT_SETUP_DRAFT)
  const [step, setStep] = useState<SetupStep>("identity")
  const [error, setError] = useState<string | undefined>()
  const [detectedSessionUrls, setDetectedSessionUrls] = useState<readonly string[]>([])
  const [serverStatus, setServerStatus] = useState<ServerStatus>("idle")
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus>("idle")
  const [verifiedSession, setVerifiedSession] = useState<JmapSession | undefined>()
  const [verifiedSessionUrl, setVerifiedSessionUrl] = useState<string | undefined>()
  const manualUrl = manualSessionUrl(draft)
  const effectiveServerStatus = manualUrl === undefined ? serverStatus : isHttpsUrl(manualUrl) ? "fallback" : "error"
  const navigationBusy = serverStatus === "checking" || credentialStatus === "checking"

  const update = (patch: Partial<AccountSetupDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setError(undefined)
    setCredentialStatus("idle")
    setVerifiedSession(undefined)
    setVerifiedSessionUrl(undefined)
    if (patch.email !== undefined) {
      setDetectedSessionUrls([])
      setServerStatus("idle")
    }
    if (patch.sessionUrl !== undefined) {
      const manual = patch.sessionUrl.trim()
      if (manual.length > 0) {
        setServerStatus(isHttpsUrl(manual) ? "fallback" : "error")
      } else {
        setServerStatus(detectedSessionUrls.length === 0 ? "idle" : detectedSessionUrls[0] === wellKnownSessionUrl(domainFromEmailAddress(draft.email) ?? "") ? "fallback" : "srv")
      }
    }
  }

  const goToStep = (nextStep: SetupStep) => {
    setError(undefined)
    if (credentialStatus === "error") setCredentialStatus("idle")
    setStep(nextStep)
  }

  const next = async () => {
    if (step === "identity") {
      const identityError = setupStepError(step, draft, effectiveServerStatus)
      if (identityError !== undefined) {
        setError(identityError)
        return
      }
      const ok = await runServerDiscovery(draft)
      if (!ok) return
      goToStep("server")
      return
    }

    if (step === "auth") {
      const stepError = authStepError(draft)
      if (stepError !== undefined) {
        setError(stepError)
        return
      }
      setError(undefined)
      setCredentialStatus("checking")
      setVerifiedSession(undefined)
      setVerifiedSessionUrl(undefined)
      try {
        const { session, sessionUrl } = await verifyCredentials(draft, fetchImpl)
        setVerifiedSession(session)
        setVerifiedSessionUrl(sessionUrl)
        setCredentialStatus("ok")
        goToStep("review")
      } catch (err) {
        setCredentialStatus("error")
        setError(credentialErrorMessage(err))
      }
      return
    }

    if (step === "server") {
      const stepError = setupStepError(step, draft, effectiveServerStatus)
      if (stepError !== undefined) {
        setError(stepError)
        return
      }
      setError(undefined)
      setServerStatus("checking")
      try {
        const sessionUrl = await validateServerEndpoint(draft, fetchImpl)
        setDraft((current) => ({ ...current, sessionUrl }))
        setServerStatus(detectedSessionUrls.some((url) => url === sessionUrl && url !== wellKnownSessionUrl(domainFromEmailAddress(draft.email) ?? "")) ? "srv" : "fallback")
        goToStep("auth")
      } catch (err) {
        setServerStatus("error")
        setError(serverEndpointErrorMessage(err))
      }
      return
    }

    const stepError = setupStepError(step, draft, effectiveServerStatus)
    if (stepError !== undefined) {
      setError(stepError)
      return
    }
    goToStep(nextSetupStep(step))
  }

  const runServerDiscovery = async (accountDraft: AccountSetupDraft): Promise<boolean> => {
    const domain = domainFromEmailAddress(accountDraft.email)
    if (domain === undefined) {
      setError("Enter a valid email address first.")
      return false
    }
    setServerStatus("checking")
    setDetectedSessionUrls([])
    try {
      const urls = await discoveryCandidates({
        email: accountDraft.email,
        auth: DISCOVERY_ONLY_AUTH,
        resolveSrv: resolveJmapSrvFresh,
      })
      setDetectedSessionUrls(urls)
      const firstUrl = urls[0]
      if (firstUrl !== undefined) setDraft((current) => ({ ...current, sessionUrl: firstUrl }))
      const fallbackUrl = wellKnownSessionUrl(domain)
      const hasSrvCandidate = urls.some((url) => url !== fallbackUrl)
      setServerStatus(hasSrvCandidate ? "srv" : "fallback")
      setError(undefined)
      return true
    } catch (err) {
      setServerStatus("error")
      setError(connectivityErrorMessage(err))
      return false
    }
  }
  const back = () => goToStep(previousSetupStep(step))

  const addVerifiedAccount = () => {
    if (verifiedSession === undefined || verifiedSessionUrl === undefined) {
      setError("Credentials must be verified before adding the account.")
      setStep("auth")
      return
    }
    const account = createConfiguredAccount(draft, {
      status: "ready",
      verifiedAt: new Date().toISOString(),
      sessionUrl: verifiedSessionUrl,
      capabilities: Object.keys(verifiedSession.capabilities),
      ...(verifiedSession.primaryAccounts[CAP_MAIL] === undefined || verifiedSession.primaryAccounts[CAP_MAIL] === null
        ? {}
        : { primaryMailAccountId: verifiedSession.primaryAccounts[CAP_MAIL] }),
    })
    onAccountVerified(account, authFromDraft(draft))
    setDraft(EMPTY_ACCOUNT_SETUP_DRAFT)
    setStep("identity")
    setCredentialStatus("idle")
    setVerifiedSession(undefined)
    setVerifiedSessionUrl(undefined)
  }

  return (
    <View style={styles.setupFlow}>
      <SetupStepper step={step} />
      {step === "identity" ? (
        <View style={styles.formBlock}>
          <Text style={styles.flowTitle}>{mode === "first-run" ? "Who are you?" : "Account identity"}</Text>
          <Text style={styles.flowCopy}>This name appears in the account list and compose identity picker.</Text>
          <Field label="Your name" value={draft.displayName} placeholder="Ada Lovelace" onChangeText={(displayName) => update({ displayName })} />
          <Field label="Email address" value={draft.email} placeholder="ada@example.com" onChangeText={(email) => update({ email })} />
        </View>
      ) : null}

      {step === "server" ? (
        <View style={styles.formBlock}>
          <Text style={styles.flowTitle}>Find mail server</Text>
          <Text style={styles.flowCopy}>We filled this in from your email address. Change it only if your provider gave you a specific address.</Text>
          <Field label="Server address" value={draft.sessionUrl ?? ""} placeholder="Optional: https://mail.example/.well-known/jmap" onChangeText={(sessionUrl) => update({ sessionUrl })} />
        </View>
      ) : null}

      {step === "auth" ? (
        <View style={styles.formBlock}>
          <Text style={styles.flowTitle}>Sign in</Text>
          <Text style={styles.flowCopy}>The setup check uses this secret once. It is not written to browser storage.</Text>
          <View style={styles.authOptions}>
            {AUTH_OPTIONS.map((option) => (
              <Pressable key={option.value} onPress={() => update({ authKind: option.value })} style={[styles.clickable, styles.authOption, draft.authKind === option.value && styles.authOptionActive]}>
                <Text style={[styles.authOptionText, draft.authKind === option.value && styles.authOptionTextActive]}>{option.label}</Text>
                <Text style={[styles.authOptionHelp, draft.authKind === option.value && styles.authOptionHelpActive]}>{option.help}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Username" value={accountLoginUsername(draft)} placeholder="Usually your full email address" onChangeText={(username) => update({ username })} />
          <Field label={draft.authKind === "basic" ? "Password" : "API token"} value={draft.secret ?? ""} placeholder="Required for connectivity check" secure onChangeText={(secret) => update({ secret })} />
          <Text style={credentialStatusStyle(credentialStatus)}>{credentialStatusText(credentialStatus, verifiedSession)}</Text>
        </View>
      ) : null}

      {step === "review" ? (
        <View style={styles.formBlock}>
          <Text style={styles.flowTitle}>Confirm account</Text>
          <Text style={styles.flowCopy}>Connectivity and credentials are already verified. Confirm to add this account to your folder pane.</Text>
          <ReviewRow label="Name" value={draft.displayName || "Missing"} />
          <ReviewRow label="Email" value={draft.email || "Missing"} />
          <ReviewRow label="Username" value={accountLoginUsername(draft) || "Missing"} />
          <ReviewRow label="Server" value={verifiedSessionUrl ?? draft.sessionUrl?.trim() ?? detectedSessionUrls[0] ?? "Automatic setup"} />
          <ReviewRow label="Auth" value={draft.authKind === "basic" ? "Basic" : "API token"} />
          {verifiedSession === undefined ? null : <Text style={styles.successText}>Connected as {verifiedSession.username}. Mail capability found.</Text>}
        </View>
      ) : null}

      {error === undefined ? null : <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.flowButtons}>
        {step === "identity" ? null : <SecondaryButton label="Back" onPress={back} />}
        {step === "review" ? (
          <PrimaryButton label="Add account" disabled={verifiedSession === undefined} onPress={addVerifiedAccount} />
        ) : (
          <PrimaryButton label="Continue" loading={navigationBusy} disabled={navigationBusy} onPress={() => { void next() }} />
        )}
      </View>
    </View>
  )
}

function Field({ label, value, placeholder, secure, onChangeText }: {
  readonly label: string
  readonly value: string
  readonly placeholder: string
  readonly secure?: boolean
  readonly onChangeText: (value: string) => void
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={value} placeholder={placeholder} placeholderTextColor="#718096" secureTextEntry={secure} onChangeText={onChangeText} autoCapitalize="none" style={styles.input} />
    </View>
  )
}

function SetupStepper({ step }: { readonly step: SetupStep }) {
  const steps: readonly SetupStep[] = ["identity", "server", "auth", "review"]
  return (
    <View style={styles.stepper}>
      {steps.map((item, index) => (
        <View key={item} style={[styles.stepPill, step === item && styles.stepPillActive]}>
          <Text style={[styles.stepText, step === item && styles.stepTextActive]}>{index + 1}. {stepLabel(item)}</Text>
        </View>
      ))}
    </View>
  )
}

function ReviewRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  )
}

function nextSetupStep(step: SetupStep): SetupStep {
  if (step === "identity") return "server"
  if (step === "server") return "auth"
  return "review"
}

function previousSetupStep(step: SetupStep): SetupStep {
  if (step === "review") return "auth"
  if (step === "auth") return "server"
  return "identity"
}

function stepLabel(step: SetupStep): string {
  if (step === "identity") return "Identity"
  if (step === "server") return "Server"
  if (step === "auth") return "Sign in"
  return "Verify"
}

function setupStepError(step: SetupStep, draft: AccountSetupDraft, serverStatus: ServerStatus): string | undefined {
  if (step === "identity") {
    if (draft.displayName.trim().length === 0) return "Enter your name before continuing."
    if (!isLikelyEmail(draft.email)) return "Enter a valid email address before continuing."
  }
  if (step === "server") {
    if (serverStatus === "checking") return "Server check is still running."
    if (serverStatus === "error") return "Use an HTTPS server address or leave it blank."
    if (serverStatus === "idle") return "Enter a valid email address first."
  }
  return undefined
}

function authStepError(draft: AccountSetupDraft): string | undefined {
  if (accountLoginUsername(draft).length === 0) return "Enter your username before continuing."
  const secret = draft.secret?.trim()
  if (secret === undefined || secret.length === 0) return draft.authKind === "basic" ? "Enter your password before continuing." : "Enter your API token before continuing."
  return undefined
}

async function verifyCredentials(draft: AccountSetupDraft, fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): Promise<{ readonly session: JmapSession; readonly sessionUrl: string }> {
  const auth = authFromDraft(draft)
  const manual = manualSessionUrl(draft)
  const result = await discoverJmapSessionWithUrl({
    email: draft.email,
    ...(manual === undefined ? {} : { sessionUrl: manual }),
    auth,
    transport: new FetchJmapTransport({ auth, fetchImpl }),
    ...(manual === undefined ? { resolveSrv: resolveJmapSrvFresh } : {}),
  })
  const discovered = result.session
  if (discovered.capabilities[CAP_MAIL] === undefined) throw new Error("Server signed in, but mail is not available.")
  return { session: discovered, sessionUrl: result.sessionUrl }
}

async function validateServerEndpoint(draft: AccountSetupDraft, fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): Promise<string> {
  const sessionUrl = manualSessionUrl(draft)
  if (sessionUrl === undefined) throw new Error("Enter a server address first.")
  if (!isHttpsUrl(sessionUrl)) throw new Error("Use an HTTPS server address.")

  const response = await fetchImpl(sessionUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "follow",
  })

  if (response.status === 401 || response.status === 403) return sessionUrl
  if (!response.ok) throw new Error(`Server address returned HTTP ${response.status}.`)

  const body = await response.json() as unknown
  let session: JmapSession
  try {
    session = parseJmapSession(body)
  } catch {
    throw new Error("Server address did not return a valid mail setup response.")
  }
  if (session.capabilities[CAP_MAIL] === undefined) throw new Error("Server is reachable, but mail is not available.")
  return sessionUrl
}

function authFromDraft(draft: AccountSetupDraft): AuthProvider {
  const secret = draft.secret?.trim()
  if (secret === undefined || secret.length === 0) throw new Error("A token or password is required before checking connectivity.")
  const username = accountLoginUsername(draft)
  if (username.length === 0) throw new Error("A username is required before checking connectivity.")
  if (draft.authKind === "basic") return { kind: "basic", username, password: secret, warnUser: true }
  if (draft.authKind === "bearer") return { kind: "bearer", token: secret, username }
  throw new Error("This authentication flow is not implemented yet.")
}

function manualSessionUrl(draft: AccountSetupDraft): string | undefined {
  const manual = draft.sessionUrl?.trim()
  return manual === undefined || manual.length === 0 ? undefined : manual
}

function domainFromEmailAddress(email: string): string | undefined {
  if (!isLikelyEmail(email)) return undefined
  return email.trim().toLowerCase().split("@").at(1)
}

function wellKnownSessionUrl(domain: string): string {
  return `https://${domain}/.well-known/jmap`
}

async function resolveJmapSrvFresh(service: "_jmap._tcp", domain: string): Promise<SrvRecord[]> {
  return resolveJmapSrvOverHttps(service, domain, { bypassCache: true })
}

function isLikelyEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function credentialStatusText(status: CredentialStatus, session: JmapSession | undefined): string {
  if (status === "checking") return "Checking credentials and server..."
  if (status === "ok") return `Credentials verified${session === undefined ? "." : ` for ${session.username}.`}`
  if (status === "error") return "Credential check failed."
  return "Click Continue to check credentials."
}

function credentialStatusStyle(status: CredentialStatus) {
  if (status === "ok") return styles.statusOk
  if (status === "error") return styles.statusError
  return styles.statusNeutral
}

function serverEndpointErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return "Could not reach this server address."
  return error instanceof Error ? error.message : "Server check failed."
}

function credentialErrorMessage(error: unknown): string {
  const cause = errorCause(error)
  if (cause instanceof JmapTransportError && (cause.status === 401 || cause.status === 403)) return "Username or secret was rejected."
  if (error instanceof JmapTransportError && (error.status === 401 || error.status === 403)) return "Username or secret was rejected."
  if (cause instanceof TypeError) return connectivityErrorMessage(cause)
  if (error instanceof JmapDiscoveryError) return "Could not sign in at the configured server."
  return connectivityErrorMessage(error)
}

function connectivityErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return "Could not reach the server. If browser setup keeps failing, try the desktop app."
  return error instanceof Error ? error.message : "Connectivity check failed."
}

function errorCause(error: unknown): unknown {
  return typeof error === "object" && error !== null && "cause" in error ? (error as { readonly cause?: unknown }).cause : undefined
}

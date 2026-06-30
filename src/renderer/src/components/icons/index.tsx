import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon(props: IconProps) {
  return <svg aria-hidden="true" {...props} />
}

export function WarningTriangleIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  )
}

export function GamepadIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
      <path d="M9 10h.01" />
      <path d="M15 10h.01" />
    </Icon>
  )
}

export function SettingsIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  )
}

export function MinimizeIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 16}
      height={props.height ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...props}
    >
      <path d="M2 8h12" />
    </Icon>
  )
}

export function MaximizeIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 16}
      height={props.height ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
      {...props}
    >
      <rect x="2" y="2" width="12" height="12" rx="2" />
    </Icon>
  )
}

export function RestoreIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 16}
      height={props.height ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
      {...props}
    >
      {/* Front window (bottom-left) */}
      <rect x="2" y="5" width="9" height="9" rx="1.5" />
      {/* Back window (offset up-right) — only the edges not hidden by the front */}
      <path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2H12.5A1.5 1.5 0 0 1 14 3.5V9.5A1.5 1.5 0 0 1 12.5 11H11" />
    </Icon>
  )
}

export function CloseWindowIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 16}
      height={props.height ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  )
}

export function RefreshIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.stroke ?? 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </Icon>
  )
}

export function CopyIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  )
}

export function ChevronDownIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 16}
      height={props.height ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 6l5 5 5-5" />
    </Icon>
  )
}

export function PlusIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      {...props}
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  )
}

export function CheckIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  )
}

export function ErrorIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </Icon>
  )
}

export function KillIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M7 7l10 10" />
      <path d="M17 7L7 17" />
    </Icon>
  )
}

export function ReloadIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 3a9 9 0 1 1-8 4.9" />
    </Icon>
  )
}

export function PlayMarkIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 24}
      height={props.height ?? 24}
      viewBox="0 0 24 24"
      fill="var(--launcher-play)"
      {...props}
    >
      <path d="M7.4 4.5A1.5 1.5 0 0 0 5 5.8v12.4a1.5 1.5 0 0 0 2.4 1.3l9.8-6.2a1.5 1.5 0 0 0 0-2.6L7.4 4.5z" />
    </Icon>
  )
}

// Full "SimLauncher" wordmark + play-mark as one vector unit so the play-mark
// stays aligned to the lettering at every zoom factor (the separate inline icon
// drifted from baseline rounding — #367/#452). Themeable: "Sim" follows
// --text-primary, "Launcher" follows currentColor (caller sets accent/muted),
// the play-mark follows --launcher-play.
export function BrandWordmarkIcon(props: IconProps): ReactNode {
  return (
    <Icon viewBox="0 0 150 18" fill="none" {...props}>
      <path
        d="M9.6814 7.19873C9.07756 6.86263 8.53638 6.62622 8.05786 6.4895C7.57935 6.35278 7.09798 6.28442 6.61377 6.28442C6.2264 6.28442 5.91878 6.36702 5.69092 6.53223C5.46875 6.69743 5.35767 6.9139 5.35767 7.18164C5.35767 7.43229 5.44881 7.64876 5.6311 7.83105C5.8134 8.01335 6.20646 8.26969 6.8103 8.6001C7.77873 9.11279 8.45378 9.64258 8.83545 10.1895C9.22282 10.7306 9.4165 11.4199 9.4165 12.2573C9.4165 13.0492 9.19434 13.7555 8.75 14.3765C8.31136 14.9974 7.70182 15.4588 6.92139 15.7607C6.14665 16.0627 5.22664 16.2136 4.16138 16.2136C3.38664 16.2136 2.66032 16.1282 1.98242 15.9573C1.31022 15.7807 0.720622 15.5557 0.213623 15.2822L0.854492 12.2573C1.94255 13.0605 3.04484 13.4622 4.16138 13.4622C5.05005 13.4622 5.49438 13.146 5.49438 12.5137C5.49438 12.2288 5.3833 11.9924 5.16113 11.8044C4.94466 11.6108 4.56014 11.3886 4.00757 11.1379C3.08472 10.705 2.42391 10.2208 2.02515 9.6853C1.63208 9.14412 1.43555 8.45483 1.43555 7.61743C1.43555 6.8256 1.65202 6.11068 2.08496 5.47266C2.5179 4.82894 3.11035 4.34757 3.8623 4.02856C4.61426 3.70386 5.48584 3.5415 6.47705 3.5415C7.26318 3.5415 7.96672 3.61271 8.58765 3.75513C9.21427 3.89754 9.78109 4.0599 10.2881 4.24219L9.6814 7.19873ZM14.1289 16H10.4375L13.0266 3.74658H16.718L14.1289 16ZM31.5646 16H27.9245L29.454 8.78809L29.8556 6.95093H29.7873L29.1549 8.47192L25.7028 16H22.3104L21.8747 8.89917C21.8405 8.42065 21.8234 7.77124 21.8234 6.95093H21.7465C21.5813 8.20988 21.3904 9.3606 21.174 10.4031L19.9862 16H16.7135L19.3026 3.74658H24.4809L24.9081 11.0696C24.9081 11.4399 24.8939 11.8244 24.8654 12.2231H24.9167C25.0135 11.9497 25.1132 11.6649 25.2157 11.3687C25.3183 11.0667 25.4236 10.7961 25.5319 10.5569L28.5226 3.74658H34.1623L31.5646 16Z"
        fill="var(--text-primary)"
      />
      <path
        d="M40.6233 16H32.7192L35.3083 3.74658H38.9998L37.0259 13.1118H41.2385L40.6233 16ZM50.531 16L50.3515 13.7441H46.6772L45.5749 16H41.5161L48.3178 3.74658H52.9064L54.2907 16H50.531ZM49.9926 7.38672C49.9926 6.99935 50.0069 6.72021 50.0354 6.54932H49.9499L49.7875 6.97656L49.4628 7.71997L47.976 10.856H50.1635L50.0012 7.78833L49.9926 7.38672ZM61.3786 16.2136C59.8576 16.2136 58.6898 15.849 57.8751 15.1199C57.0605 14.3907 56.6532 13.3311 56.6532 11.9412C56.6532 11.4228 56.7529 10.6651 56.9523 9.66821L58.2084 3.74658H61.9254L60.6437 9.70239C60.5753 10.0442 60.507 10.3717 60.4386 10.6851C60.376 10.9984 60.3446 11.2718 60.3446 11.5054C60.3446 11.9953 60.47 12.377 60.7206 12.6504C60.977 12.9238 61.3358 13.0605 61.7973 13.0605C62.3327 13.0605 62.76 12.8754 63.079 12.5051C63.4037 12.1348 63.6544 11.531 63.831 10.6936L65.3178 3.74658H69.0263L67.5053 10.9072C67.1977 12.3029 66.7875 13.3682 66.2748 14.103C65.7678 14.8379 65.1127 15.3734 64.3095 15.7095C63.5119 16.0456 62.535 16.2136 61.3786 16.2136ZM80.9164 16H78.0111L74.4564 10.0015C74.1317 9.4375 73.9209 9.01595 73.8241 8.73682H73.7899C73.6874 9.42611 73.5592 10.104 73.4054 10.7705L72.286 16H68.8766L71.4657 3.74658H74.6529L78.0794 9.4375C78.1535 9.54574 78.2503 9.72518 78.37 9.97583C78.4953 10.2208 78.5836 10.4316 78.6349 10.6082H78.6776C78.6947 10.3974 78.7289 10.1752 78.7801 9.94165L80.0875 3.74658H83.5055L80.9164 16ZM94.3018 7.33545C93.9543 7.17025 93.5726 7.03068 93.1568 6.91675C92.7409 6.80282 92.2368 6.74585 91.6443 6.74585C90.8696 6.74585 90.1974 6.9139 89.6277 7.25C89.0638 7.5804 88.628 8.04468 88.3204 8.64282C88.0184 9.23527 87.8675 9.89608 87.8675 10.6252C87.8675 11.3886 88.0982 11.9867 88.5596 12.4197C89.021 12.8469 89.6875 13.0605 90.5591 13.0605C90.9465 13.0605 91.3794 12.9979 91.858 12.8726C92.3365 12.7472 92.8007 12.5763 93.2508 12.3599L92.5159 15.7351C91.6272 16.0541 90.6474 16.2136 89.5765 16.2136C87.7763 16.2136 86.3864 15.7493 85.4065 14.8208C84.4324 13.8923 83.9454 12.6048 83.9454 10.9585C83.9454 9.48307 84.2786 8.17 84.9451 7.01929C85.6116 5.86287 86.543 4.99414 87.7393 4.41309C88.9413 3.83203 90.3484 3.5415 91.9605 3.5415C92.4789 3.5415 93.0258 3.58423 93.6011 3.66968C94.1765 3.74943 94.6607 3.84627 95.0538 3.96021L94.3018 7.33545ZM106.329 16H102.612L103.594 11.4285H99.356L98.3818 16H94.6904L97.2966 3.74658H100.988L100.022 8.28394H104.261L105.226 3.74658H108.935L106.329 16ZM118.552 6.63477H114.613L114.245 8.42065H117.937L117.33 11.3088H113.639L113.254 13.1118H117.467L116.852 16H108.947L111.537 3.74658H119.167L118.552 6.63477ZM130.485 6.91675C130.485 7.8453 130.163 8.63997 129.519 9.30078C128.881 9.96159 128.03 10.386 126.964 10.574V10.6082C127.859 10.9386 128.425 11.6677 128.665 12.7957L129.348 16H125.426L124.973 13.2742C124.882 12.7615 124.714 12.3713 124.469 12.1035C124.23 11.8301 123.877 11.6934 123.41 11.6934H123.375L122.47 16H118.778L121.367 3.74658H126.178C127.534 3.74658 128.591 4.02287 129.348 4.57544C130.106 5.12801 130.485 5.90845 130.485 6.91675ZM126.546 7.60034C126.546 7.19019 126.432 6.87118 126.204 6.64331C125.982 6.41545 125.645 6.30151 125.195 6.30151H124.537L123.905 9.10425H124.725C125.278 9.10425 125.72 8.95898 126.05 8.66846C126.38 8.37793 126.546 8.02189 126.546 7.60034Z"
        fill="currentColor"
      />
      <g clipPath="url(#brand-wordmark-play-clip)">
        <path
          d="M134.862 4.27857C134.694 4.14655 134.479 4.06762 134.243 4.0512C134.007 4.03477 133.76 4.08155 133.53 4.18594C133.301 4.29033 133.1 4.44794 132.951 4.63998C132.801 4.83201 132.71 5.05038 132.688 5.26905L131.022 14.7167C130.967 14.9353 130.981 15.1537 131.063 15.3457C131.145 15.5378 131.29 15.6954 131.483 15.7998C131.675 15.9042 131.906 15.9509 132.148 15.9345C132.39 15.9181 132.633 15.8392 132.847 15.7071L141.847 10.9833C142.055 10.8831 142.239 10.7388 142.379 10.5649C142.52 10.391 142.612 10.1937 142.648 9.99286C142.683 9.792 142.66 9.59468 142.581 9.42079C142.502 9.24691 142.369 9.10259 142.196 9.00238L134.862 4.27857Z"
          fill="var(--launcher-play)"
        />
      </g>
      <defs>
        <clipPath id="brand-wordmark-play-clip">
          <rect
            width="17.5"
            height="16.2468"
            fill="white"
            transform="matrix(1 0 -0.173648 0.984808 131.73 1.25)"
          />
        </clipPath>
      </defs>
    </Icon>
  )
}

export function DiscordIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 16}
      height={props.height ?? 16}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </Icon>
  )
}

export function GithubIcon(props: IconProps): ReactNode {
  return (
    <Icon
      width={props.width ?? 16}
      height={props.height ?? 16}
      viewBox="0 0 16 16"
      fill="currentColor"
      {...props}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </Icon>
  )
}

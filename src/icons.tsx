import type { SVGProps } from 'react'

const Icon = ({ children, ...props }: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" {...props}>{children}</svg>
)

export const SpeakerIcon = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8.5 8.5 0 0 1 0 12"/></Icon>
export const StopIcon = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><rect height="12" rx="1" width="12" x="6" y="6"/></Icon>

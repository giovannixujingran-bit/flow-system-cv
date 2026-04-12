# What Not To Edit

These are hard boundaries for this skill.

## Do not move parsing into view code

- Do not parse raw external payloads inside React components.
- Do not make `tasks-board.tsx`, task detail pages, or CSS responsible for task understanding.

## Do not call AI from serializer or routes

- Do not call AI from `runtime.ts` serializers.
- Do not embed AI prompting directly in route handlers.
- Route handlers may validate, orchestrate, and delegate only.

## Do not break ordinary task fallback

- Do not assume every task has external-task projection.
- Do not remove or rewrite the current placeholder stepper for ordinary tasks unless the external projection exists and is present.

## Do not overload existing task semantics

- Do not stuff raw external payloads, reply history, or progress-item detail into generic `TaskRecord` fields that ordinary tasks already use.
- Keep companion-record data separate and attach it through an optional serializer projection.

## Do not change conversation message semantics casually

- Do not invent a new conversation message type if `openclaw_reply` already fits.
- Do not alter the meaning of `user_message`, `incoming_delivery`, or `openclaw_reply` just to fit external-task logic.

## Do not overfit to one case

- Do not make `trend-summary` the only supported task kind.
- Do not hardcode lingerie-specific or Excel-specific copy outside the example or reusable template variables.

## Do not promote internal types into public protocol by default

- Keep `ExternalTaskRecord`, reply history, and UI projection internals in `platform-api`.
- Only put request/response transport contracts into `@flow-system/flow-protocol`.

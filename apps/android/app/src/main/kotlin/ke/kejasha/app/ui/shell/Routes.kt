package ke.kejasha.app.ui.shell

import kotlinx.serialization.Serializable

/** A bottom-bar tab; [name] picks the screen. */
@Serializable data class TabRoute(val name: String)

@Serializable data class PaymentRoute(val id: String)

/** Ask a tenant (lease) or a guest (booking) to pay; neither means "pick a lease". */
@Serializable data class RequestPaymentRoute(val leaseId: String? = null, val bookingId: String? = null)

@Serializable data class TicketRoute(val id: String)

/** A repair from the caretaker's offline copy (it may not have reached the API yet). */
@Serializable data class LocalTicketRoute(val id: String)

@Serializable data object ReportTicketRoute

@Serializable data object LogCashRoute

/** A tenant pays rent on one lease by M-Pesa prompt. */
@Serializable data class TenantPayRoute(val leaseId: String)

/** An M-Pesa SMS shared into the app (see SharedText). */
@Serializable data object SmsPaymentRoute

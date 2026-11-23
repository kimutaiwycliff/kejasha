package ke.kejasha.app.ui.shell

import kotlinx.serialization.Serializable

/** A bottom-bar tab; [name] picks the screen. */
@Serializable data class TabRoute(val name: String)

@Serializable data class PaymentRoute(val id: String)

/** Ask a tenant (lease) or a guest (booking) to pay; neither means "pick a lease". */
@Serializable data class RequestPaymentRoute(val leaseId: String? = null, val bookingId: String? = null)

@Serializable data class TicketRoute(val id: String)

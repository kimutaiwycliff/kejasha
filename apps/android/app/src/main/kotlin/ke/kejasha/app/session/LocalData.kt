package ke.kejasha.app.session

/** Data kept on the phone for a signed-in account (the caretaker's offline copy and outbox). */
interface LocalData {
    /** Writes made offline that have not reached the API. */
    suspend fun unsynced(): Int

    /** Signed out: nothing of the account stays on the phone. */
    suspend fun clear()

    /** Signed in or switched organization. */
    fun onAccount(account: Account)
}

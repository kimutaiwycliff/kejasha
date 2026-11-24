package ke.kejasha.app.ui

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import ke.kejasha.app.TestApi
import ke.kejasha.app.session.Account
import ke.kejasha.app.session.LocalData
import ke.kejasha.app.session.SessionRepository
import ke.kejasha.app.session.TokenStore
import ke.kejasha.app.net.AuthInterceptor
import ke.kejasha.app.ui.signin.SignInScreen
import ke.kejasha.app.ui.signin.SignInViewModel
import ke.kejasha.app.ui.theme.KejashaTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The sign-in screen on the JVM (Robolectric) against a fake API. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SignInScreenTest {
    @get:Rule val compose = createComposeRule()
    private val api = TestApi()

    @After fun close() = api.close()

    private object NoTokens : TokenStore {
        override val current: String? = null
        override suspend fun load(): TokenStore.Stored? = null
        override suspend fun save(stored: TokenStore.Stored) = Unit
        override suspend fun clear() = Unit
    }

    private object NoLocalData : LocalData {
        override suspend fun unsynced() = 0
        override suspend fun clear() = Unit
        override fun onAccount(account: Account) = Unit
    }

    private fun show() {
        val session = SessionRepository(api.create(), api.create(), api.create(), NoTokens, NoLocalData, AuthInterceptor(NoTokens))
        val vm = SignInViewModel(session)
        compose.setContent { KejashaTheme { SignInScreen(vm) } }
    }

    @Test fun `a phone number is needed before a code is sent`() {
        show()
        compose.onNodeWithText("Send code").assertIsNotEnabled()
        compose.onNodeWithTag("phone").performTextInput("0712345678")
        compose.onNodeWithText("Send code").assertIsEnabled()
    }

    @Test fun `sending the code asks for it, and verify waits for six digits`() {
        api.reply("""{"expiresInSeconds":300}""")
        show()
        compose.onNodeWithTag("phone").performTextInput("0712345678")
        compose.onNodeWithText("Send code").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Verify").fetchSemanticsNodes().isNotEmpty() }
        assertEquals("/v1/identity/otp/request", api.server.takeRequest().target)
        compose.onNodeWithTag("code").performTextInput("12345")
        compose.onNodeWithText("Verify").assertIsNotEnabled()
        compose.onNodeWithTag("code").performTextInput("6")
        compose.onNodeWithText("Verify").assertIsEnabled()
    }

    @Test fun `the API's field message shows under the field`() {
        api.reply(
            """{"type":"about:blank","title":"Invalid request","status":422,"code":"validation_failed",
               "errors":[{"path":"body.phone","message":"Enter a Kenyan mobile number"}]}""",
            422,
        )
        show()
        compose.onNodeWithTag("phone").performTextInput("12")
        compose.onNodeWithText("Send code").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Enter a Kenyan mobile number").fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun `every tappable element has a name`() {
        show()
        val unnamed = compose.onAllNodes(hasClickAction() and !hasName()).fetchSemanticsNodes()
        assertEquals("Unnamed tappable elements: ${unnamed.map { it.config }}", 0, unnamed.size)
    }

    private fun hasName() = SemanticsMatcher("has a text or content description") {
        val c = it.config
        (c.contains(SemanticsProperties.Text) || c.contains(SemanticsProperties.ContentDescription) || c.contains(SemanticsProperties.EditableText)) ||
            it.children.any { child -> child.config.contains(SemanticsProperties.Text) || child.config.contains(SemanticsProperties.ContentDescription) }
    }
}

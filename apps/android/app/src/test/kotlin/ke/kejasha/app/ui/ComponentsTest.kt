package ke.kejasha.app.ui

import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import ke.kejasha.app.ui.common.Picker
import ke.kejasha.app.ui.theme.KejashaTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ComponentsTest {
    @get:Rule val compose = createComposeRule()

    @Test fun `a picker announces its label and choice, and opens its list`() {
        compose.setContent {
            KejashaTheme {
                var unit by remember { mutableStateOf<String?>(null) }
                Picker("Unit", listOf("a" to "A1", "b" to "B2"), unit, { unit = it }, tag = "unit")
            }
        }
        compose.onNodeWithTag("unit").assertContentDescriptionEquals("Unit: not chosen")
        compose.onNodeWithTag("unit").performClick()
        compose.onNodeWithText("B2").performClick()
        compose.onNodeWithTag("unit").assertContentDescriptionEquals("Unit: B2")
    }
}

package io.github.shaunxd.canasta;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        if (bridge == null) return;

        View content = findViewById(android.R.id.content);
        WindowInsetsControllerCompat bars = new WindowInsetsControllerCompat(getWindow(), content);
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.statusBars());
        // Size the entire WebView to the usable display, including when the keyboard
        // opens or a fold/rotation moves the gesture bar or camera cutout.
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            Insets padding = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = bridge.getWebView();
                web.evaluateJavascript("window.dispatchEvent(new Event('canasta-back', {cancelable:true}))",
                    unhandled -> {
                        if ("false".equals(unhandled)) return;
                        if ("https://canasta-website.vercel.app/".equals(web.getUrl()) || !web.canGoBack()) {
                            moveTaskToBack(true);
                        } else {
                            web.goBack();
                        }
                    });
            }
        });
    }
}

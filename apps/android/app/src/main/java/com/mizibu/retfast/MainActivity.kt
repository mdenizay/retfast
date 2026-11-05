package com.mizibu.retfast

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import com.mizibu.retfast.ui.RetfastRoot
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { RetfastRoot() }
    }

    override fun onStart() {
        super.onStart()
        // The app is visible, so a location foreground service may be (re)started: resume an interrupted
        // recording / retrieve waiting / retriever duty from SQLite and flush unsent data.
        lifecycleScope.launch {
            graph.engine.restore()
            graph.retrievals.resumeAll()
            graph.sync.kick()
        }
    }
}

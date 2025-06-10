// Navbar Toggle
    document.getElementById('menu-toggle').addEventListener('click', () => {
        const navLinks = document.getElementById('nav-links');
        navLinks.classList.toggle('active');
    });

    // Fetch Services
    fetch('/api/services')
        .then(response => response.json())
        .then(data => {
            const servicesList = document.getElementById('services-list');
            servicesList.innerHTML = '';
            Object.entries(data.services).forEach(([name, details]) => {
                const serviceCard = document.createElement('div');
                serviceCard.className = 'service-card';
                serviceCard.innerHTML = `
                    <h3 class="text-xl font-semibold mb-2">${name}</h3>
                    <p class="text-gray-600">Click to view details</p>
                `;
                
                serviceCard.addEventListener('click', () => {
                    document.getElementById('service-title').textContent = name;
                    document.getElementById('service-documents').innerHTML = `<strong>Required Documents:</strong> ${details.documents.split(',').map(doc => doc.trim()).join('<br>')}`;
                    document.getElementById('service-charges').innerHTML = `<strong>Charges:</strong> ${details.charges}`;
                    document.getElementById('service-modal').style.display = 'flex';
                    // Set service name in apply modal
                    const applyReason = document.getElementById('apply-reason');
                    applyReason.value = name;
                    document.querySelector('#service-modal a[href="#apply"]').addEventListener('click', () => {
                        document.getElementById('service-modal').style.display = 'none';
                        document.getElementById('apply-modal').style.display = 'flex';
                    }, { once: true });
                });
                servicesList.appendChild(serviceCard);
            });
        })
        .catch(error => {
            console.error('Error fetching services:', error);
            document.getElementById('services-list').innerHTML = '<p>Error loading services. Please try again later.</p>';
        });

    // Modal Close Handlers
    document.querySelectorAll('.modal-close, .cancel').forEach(button => {
        button.addEventListener('click', () => {
            button.closest('.modal').style.display = 'none';
        });
    });

    // Click outside modal to close
    window.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });

    // Track Form Submission
    document.getElementById('track-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const orderId = document.getElementById('order-id').value.trim();
        const Number = document.getElementById('phone-number').value.trim();
        const trackResult = document.getElementById('track-result');
        const statusContent = document.getElementById('status-content');
        const statusModal = document.getElementById('status-modal');
        const phoneNumber = `91${Number}`;
        if (!orderId || !phoneNumber) {
            trackResult.innerHTML = '<p class="text-red-500">Please enter both Order ID and Phone Number.</p>';
            return;
        }

        fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, phoneNumber })
        })
            .then(response => response.json())
            .then(data => {
                trackResult.innerHTML = '';
                if (data.error) {
                    trackResult.innerHTML = `<p class="text-red-500">${data.error}</p>`;
                } else {
                    let content = `
                        <p><strong>Order ID:</strong> ${data.orderId}</p>
                        <p><strong>Service Type:</strong> ${data.serviceType}</p>
                        <p><strong>Status:</strong> ${data.status}</p>
                        <p><strong>Last Updated:</strong> ${data.lastUpdated}</p>
                    `;
                    if (data.documents && data.documents.length > 0) {
                        content += `<p><strong>Completed Documents:</strong></p><ul>`;
                        data.documents.forEach(doc => {
                            content += `
                                <li>
                                    <a href="/api/document/${data.orderId}/${doc.documentId}?phoneNumber=${phoneNumber}"
                                    download="${doc.filename}"
                                    class="text-blue-600 hover:underline"
                                    target="_blank">${doc.filename}</a>
                                </li>
                            `;
                        });
                        content += `</ul>`;
                    }
                    statusContent.innerHTML = content;
                    statusModal.style.display = 'flex';
                }
            })
            .catch(error => {
                console.error('Error tracking order:', error);
                trackResult.innerHTML = '<p class="text-red-500">Error tracking order. Please try again later.</p>';
            });
    });

    // Apply Form Submission
    document.getElementById('apply-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.target;
        const formData = new FormData(form);
        const files = document.getElementById('apply-files').files;
        const applyModal = document.getElementById('apply-modal');
        const statusModal = document.getElementById('status-modal');
        const statusContent = document.getElementById('status-content');

        // Client-side validation
        if (files.length === 0) {
            statusContent.innerHTML = '<p class="text-red-500">Please upload at least one document.</p>';
            statusModal.style.display = 'flex';
            return;
        }
        if (files.length > 10) {
            statusContent.innerHTML = '<p class="text-red-500">You can upload a maximum of 10 documents.</p>';
            statusModal.style.display = 'flex';
            return;
        }
        for (let file of files) {
            if (file.size > 10 * 1024 * 1024) {
                statusContent.innerHTML = `<p class="text-red-500">File ${file.name} exceeds 10MB limit.</p>`;
                statusModal.style.display = 'flex';
                return;
            }
        }

        fetch('/api/apply', {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    statusContent.innerHTML = `<p class="text-red-500">${data.error}</p>`;
                    statusModal.style.display = 'flex';
                } else {
                    statusContent.innerHTML = `
                        <p class="text-green-500">${data.message}</p>
                        <p><strong>Order ID:</strong> ${data.orderId}</p>
                    `;
                    statusModal.style.display = 'flex';
                    form.reset();
                    applyModal.style.display = 'none';
                }
            })
            .catch(error => {
                console.error('Error submitting application:', error);
                statusContent.innerHTML = '<p class="text-red-500">Error submitting application. Please try again later.</p>';
                statusModal.style.display = 'flex';
            });
    });